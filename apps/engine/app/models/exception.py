import traceback
from typing import Any

from loguru import logger


class HttpException(Exception):
    def __init__(
        self,
        task_id: str,
        status_code: int,
        message: str = "",
        generation_id: str | None = None,
    ):
        self.task_id = task_id
        self.status_code = status_code
        self.message = message
        self.generation_id = generation_id
        # Retrieve the exception stack trace information.
        tb_str = traceback.format_exc().strip()
        if not tb_str or tb_str == "NoneType: None":
            msg = f"HttpException: {status_code}, {task_id}, {message}"
        else:
            msg = f"HttpException: {status_code}, {task_id}, {message}\n{tb_str}"

        # Bind structured context: the PostHog sink forwards these extras as
        # filterable event properties, so the reason stays visible without
        # parsing the flat message string.
        bind_kwargs: dict[str, Any] = {"task_id": task_id, "http_status_code": status_code}
        if generation_id:
            bind_kwargs["generation_id"] = generation_id
        bound = logger.bind(**bind_kwargs)
        # Attribute the record to the raise site (the frame that constructed
        # this exception), not __init__: the PostHog sink groups flat ERROR
        # logs by module:function, so without depth every 5xx raised anywhere
        # would collapse into one "...:__init__" issue. Same attribution for
        # the 4xx warning path so console/file logs point at the caller too.
        if status_code >= 500:
            bound.opt(depth=1).error(msg)
        else:
            bound.opt(depth=1).warning(msg)


class FileNotFoundException(Exception):
    pass
