import traceback
from typing import Any, Optional

from loguru import logger


class HttpException(Exception):
    def __init__(
        self,
        task_id: str,
        status_code: int,
        message: str = "",
        data: Any = None,
        generation_id: Optional[str] = None,
    ):
        self.task_id = task_id
        self.status_code = status_code
        self.message = message
        self.data = data
        self.generation_id = generation_id
        # Retrieve the exception stack trace information.
        tb_str = traceback.format_exc().strip()
        if not tb_str or tb_str == "NoneType: None":
            msg = f"HttpException: {status_code}, {task_id}, {message}"
        else:
            msg = f"HttpException: {status_code}, {task_id}, {message}\n{tb_str}"

        # Bind structured context: the PostHog sink forwards these extras as
        # filterable event properties, so the reason stays visible without
        # parsing the flat message string. generation_id (the caller's own
        # correlation id) is bound only when actually known — never a blank
        # prop — so 404 polls can be joined back to the caller's records.
        bind_kwargs: dict[str, Any] = {
            "task_id": task_id,
            "http_status_code": status_code,
        }
        if generation_id:
            bind_kwargs["generation_id"] = generation_id
        bound = logger.bind(**bind_kwargs)
        if status_code == 400:
            bound.warning(msg)
        else:
            bound.error(msg)


class FileNotFoundException(Exception):
    pass
