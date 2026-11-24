import threading
from typing import Any, Callable, Dict

from loguru import logger


class TaskQueueFullError(ValueError):
    pass


class RunningReservation:
    """One running slot already counted in ``current_tasks``.

    The caller writes task state after ``try_reserve_running`` returns,
    outside the manager lock, then either starts the worker or gives the
    slot back. ``start`` hands the count to the worker (``task_done``
    releases it, and a failed spawn releases it inside ``_spawn_reserved``).
    ``release`` returns the count now and lets a queued direct task start.
    """

    def __init__(self, manager: "TaskManager") -> None:
        self._manager = manager
        self._held = True

    def release(self) -> None:
        if not self._held:
            return
        self._held = False
        with self._manager.lock:
            self._manager.current_tasks -= 1
        self._manager.check_queue()

    def start(self, func: Callable, *args: Any, **kwargs: Any) -> None:
        if not self._held:
            raise RuntimeError("running reservation is not held")
        self._held = False
        self._manager._spawn_reserved(func, *args, **kwargs)


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
        if start_now:
            self._spawn_reserved(func, *args, **kwargs)

    def try_reserve_running(self) -> RunningReservation | None:
        """Reserve one running slot, or return None when none is free.

        Does not queue. The lock is released before this returns, so the
        caller can write task state and then ``RunningReservation.start``
        or ``release``. Direct ``add_task`` is unchanged and still queues
        when the running cap is already taken.
        """
        with self.lock:
            if self.current_tasks >= self.max_concurrent_tasks:
                return None
            self.current_tasks += 1
            logger.info(
                f"reserve running slot, current_tasks: {self.current_tasks}"
            )
            return RunningReservation(self)

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
            func(*args, **kwargs)
        finally:
            self.task_done()

    def check_queue(self):
        reserved: Dict | None = None
        with self.lock:
            while (
                self.current_tasks < self.max_concurrent_tasks
                and not self.is_queue_empty()
            ):
                task_info = self.dequeue()
                if isinstance(task_info, dict):
                    self.current_tasks += 1
                    reserved = task_info
                    break
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
