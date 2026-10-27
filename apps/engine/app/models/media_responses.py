"""Response envelopes for local media endpoints (BGM, video materials).

These classes used to live in app/models/schema.py. They were moved here so
schema.py stays under the 500-line file-size ratchet while the segments
contract is added there. The envelope fields (status, message, body) match
schema.BaseResponse exactly; schema.py re-exports these names so existing
imports keep working.
"""

from typing import Any, Optional

from pydantic import BaseModel


class MediaBaseResponse(BaseModel):
    status: int = 200
    message: Optional[str] = "success"
    body: Any = None


class BgmRetrieveResponse(MediaBaseResponse):
    class Config:
        json_schema_extra = {
            "example": {
                "status": 200,
                "message": "success",
                "body": {
                    "files": [
                        {
                            "name": "output013.mp3",
                            "size": 1891269,
                            "file": "/post-engineer/resource/songs/output013.mp3",
                        }
                    ]
                },
            },
        }


class BgmUploadResponse(MediaBaseResponse):
    class Config:
        json_schema_extra = {
            "example": {
                "status": 200,
                "message": "success",
                "body": {"file": "/post-engineer/resource/songs/example.mp3"},
            },
        }


class VideoMaterialRetrieveResponse(MediaBaseResponse):
    class Config:
        json_schema_extra = {
            "example": {
                "status": 200,
                "message": "success",
                "body": {
                    "files": [
                        {
                            "name": "example.mp4",
                            "size": 12345678,
                            "file": "/post-engineer/resource/videos/example.mp4",
                        }
                    ]
                },
            },
        }


class VideoMaterialUploadResponse(MediaBaseResponse):
    class Config:
        json_schema_extra = {
            "example": {
                "status": 200,
                "message": "success",
                "body": {
                    "file": "/post-engineer/resource/videos/example.mp4",
                },
            },
        }
