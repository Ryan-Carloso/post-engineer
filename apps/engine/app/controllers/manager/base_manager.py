import threading
from typing import Any, Callable, Dict

from loguru import logger


class TaskQueueFullError(ValueError):
    pass


class TaskManager:
    def __init__(self, max_concurrent_tasks: int, max_queued_tasks: int = 100):
        self.max_concurrent_tasks = max_concurrent_tasks
        self.max_queued_tasks = max_queued_tasks
        self.current_tasks = 0
        self.lock = threading.Lock()
        self.queue = self.create_queue()

    def create_queue(self):
        raise NotImplementedError()

    def add_task(
        self,
        func: Callable,
        *args: Any,
        on_accepted: Callable[[], None] | None = None,
        **kwargs: Any,
    ):
        """Queue (or immediately run) ``func``.

        ``on_accepted`` fires once the task is accepted — before the worker
        thread starts on the immediate path, after enqueue on the queued
        path — and never on a TaskQueueFullError rejection. It must stay
        fast and non-blocking: it runs while the manager lock is held.
        """
        with self.lock:
            if self.current_tasks < self.max_concurrent_tasks:
                logger.info(
                    f"add task: {func.__name__}, current_tasks: {self.current_tasks}"
                )
                # Reserve the slot before the worker runs. Counting inside
                # the thread, after this lock is released, lets a tight
                # burst of add_task calls all observe current_tasks == 0
                # and all start at once. Boot redispatch of many orphans
                # is that burst. task_done releases the slot.
                self.current_tasks += 1
                try:
                    if on_accepted is not None:
                        on_accepted()
                except Exception:
                    self.current_tasks -= 1
                    raise
                start_now = True
            else:
                queue_size = self.queue_size()
                # Only queue once concurrency is full. The queue must be
                # bounded: an open API can otherwise keep stacking task
                # objects and request params until memory or third-party
                # API cost runs away.
                if queue_size >= self.max_queued_tasks:
                    logger.warning(
                        f"reject task: {func.__name__}, queue_size: {queue_size}, "
                        f"max_queued_tasks: {self.max_queued_tasks}"
                    )
                    raise TaskQueueFullError("task queue is full, please try again later")

                logger.info(
                    f"enqueue task: {func.__name__}, current_tasks: {self.current_tasks}, "
                    f"queue_size: {queue_size}"
                )
                self.enqueue({"func": func, "args": args, "kwargs": kwargs})
                if on_accepted is not None:
                    on_accepted()
                start_now = False
        # Spawn outside the lock so the worker can take it (task_done)
        # without deadlocking against the caller still inside add_task.
        # The slot is already reserved, so a concurrent add_task queues.
        if start_now:
            self._spawn_reserved(func, *args, **kwargs)

    def _spawn_reserved(self, func: Callable, *args: Any, **kwargs: Any) -> None:
        """Start a worker for a concurrency slot that is already reserved.

        On a failure to spawn, release the slot. Otherwise it stays taken
        until the worker reaches task_done, and the manager wedges at the cap.
        """
        try:
            self.execute_task(func, *args, **kwargs)
        except Exception:
            with self.lock:
                self.current_tasks -= 1
            raise

    def execute_task(self, func: Callable, *args: Any, **kwargs: Any):
        thread = threading.Thread(
            target=self.run_task, args=(func, *args), kwargs=kwargs
        )
        thread.start()

    def run_task(self, func: Callable, *args: Any, **kwargs: Any):
        try:
            # The slot was reserved by add_task/check_queue before this
            # thread started. Incrementing again would double-count and
            # stall the queue behind a phantom extra task.
            func(*args, **kwargs)
        finally:
            self.task_done()

    def check_queue(self):
        reserved: Dict | None = None
        with self.lock:
            if (
                self.current_tasks < self.max_concurrent_tasks
                and not self.is_queue_empty()
            ):
                task_info = self.dequeue()
                # Redis can observe an empty pop between the llen check and
                # lpop. Do not reserve a slot for a missing item.
                if isinstance(task_info, dict):
                    self.current_tasks += 1
                    reserved = task_info
        if reserved is None:
            return
        self._spawn_reserved(
            reserved["func"],
            *reserved.get("args", ()),
            **reserved.get("kwargs", {}),
        )

    def task_done(self):
        with self.lock:
            self.current_tasks -= 1
        self.check_queue()

    def enqueue(self, task: Dict):
        raise NotImplementedError()

    def dequeue(self):
        raise NotImplementedError()

    def is_queue_empty(self):
        raise NotImplementedError()

    def queue_size(self):
        raise NotImplementedError()
