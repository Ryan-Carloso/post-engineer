"""Map a task output file to the public download URI for its response."""

import os

from loguru import logger

from app.utils import file_security


def task_file_to_uri(file: str, endpoint: str, task_dir: str, request_id: str) -> str:
    if not isinstance(file, str):
        return file

    if file.startswith(("http://", "https://")):
        return file

    try:
        file_security.resolve_path_within_directory(task_dir, file)
    except ValueError as exc:
        logger.warning(
            f"skip unsafe task output path, request_id: {request_id}, path: {file}, "
            f"error: {str(exc)}"
        )
        return file

    logical_path = file
    if os.path.isabs(logical_path):
        relative_path = os.path.relpath(logical_path, task_dir)
    else:
        relative_path = os.path.relpath(os.path.join(task_dir, logical_path), task_dir)
    relative_path = relative_path.replace("\\", "/")
    uri_path = f"api/v1/download/{relative_path}"
    if endpoint:
        return f"{endpoint.rstrip('/')}/{uri_path}"
    return f"/{uri_path}"
