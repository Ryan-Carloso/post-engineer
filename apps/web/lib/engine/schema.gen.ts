// GENERATED FILE — do not edit by hand.
// Source: apps/engine/openapi.json (engine OpenAPI contract snapshot).
// Regenerate: node apps/web/scripts/generate-engine-types.mjs

export interface paths {
    "/api/v1/audio": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Generate audio only */
        post: operations["create_audio_api_v1_audio_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/audio/preflight-duration": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Measure narration duration before charging (full lip-sync gate) */
        post: operations["preflight_duration_api_v1_audio_preflight_duration_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/cloned-voices": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the caller's cloned voices */
        get: operations["list_cloned_voices_api_v1_cloned_voices_get"];
        put?: never;
        /** Register reference audio as a cloned Chatterbox voice */
        post: operations["create_cloned_voice_api_v1_cloned_voices_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/cloned-voices/{clone_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get one cloned voice (status polling) */
        get: operations["get_cloned_voice_api_v1_cloned_voices__clone_id__get"];
        put?: never;
        post?: never;
        /** Delete a cloned voice */
        delete: operations["delete_cloned_voice_api_v1_cloned_voices__clone_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/cloned-voices/{clone_id}/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** TTS preview for a ready cloned voice (audio/mpeg) */
        post: operations["preview_cloned_voice_api_v1_cloned_voices__clone_id__preview_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/cloned-voices/denoise-preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Cleaned version of a reference recording (audio/wav), for A/B before cloning */
        post: operations["denoise_preview_api_v1_cloned_voices_denoise_preview_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/download/{file_path}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Download Video
         * @description Download the archived video.
         *
         *     R2 is the source of truth and the local disk is never read: the archived,
         *     size-verified object is served through a time-limited signed URL, which
         *     also carries the attachment disposition R2 applies for a GET.
         *
         *     :param request: Request request
         *     :param file_path: video file path, eg: /cd1727ed-3473-42a2-a7da-4faafafec72b/final-1.mp4
         *     :return: 302 to the signed archive URL, or 404 when nothing was archived
         */
        get: operations["download_video_api_v1_download__file_path__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/media/check": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Mechanically check one image URL or media id (MCP check_media) */
        post: operations["check_media_api_v1_media_check_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/musics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Retrieve local BGM files */
        get: operations["get_bgm_list_api_v1_musics_get"];
        put?: never;
        /** Upload the BGM file to the songs directory */
        post: operations["upload_bgm_file_api_v1_musics_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/personas": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Validate a persona payload (stateless — no persistence) */
        post: operations["validate_persona_endpoint_api_v1_personas_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/personas/voices": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** House voice catalog */
        get: operations["list_house_voices_endpoint_api_v1_personas_voices_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/personas/voices/{voice_id}/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** TTS preview for a house voice (audio/mpeg) */
        post: operations["preview_house_voice_endpoint_api_v1_personas_voices__voice_id__preview_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/personas/voices/{voice_id}/sample": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Short TTS sample for a house voice (audio/mpeg) */
        get: operations["voice_sample_endpoint_api_v1_personas_voices__voice_id__sample_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/personas/voices/sample-languages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Languages available for voice samples */
        get: operations["list_sample_languages_endpoint_api_v1_personas_voices_sample_languages_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/stream/{file_path}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Stream Video */
        get: operations["stream_video_api_v1_stream__file_path__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/subtitle": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Generate subtitle only */
        post: operations["create_subtitle_api_v1_subtitle_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tasks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get all tasks */
        get: operations["get_all_tasks_api_v1_tasks_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tasks/{task_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Query task status */
        get: operations["get_task_api_v1_tasks__task_id__get"];
        put?: never;
        post?: never;
        /** Delete a generated short video task */
        delete: operations["delete_video_api_v1_tasks__task_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tasks/{task_id}/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Stream task progress via Server-Sent Events */
        get: operations["task_events_api_v1_tasks__task_id__events_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/temp_assets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Store a temporary input asset (debug flow) */
        post: operations["upload_temp_asset_api_v1_temp_assets_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/temp_assets/{name}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Temp Asset */
        get: operations["get_temp_asset_api_v1_temp_assets__name__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/video_materials": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Retrieve local video materials */
        get: operations["get_video_materials_list_api_v1_video_materials_get"];
        put?: never;
        /** Upload the video material file to the local videos directory */
        post: operations["upload_video_material_file_api_v1_video_materials_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/videos": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Generate a short video */
        post: operations["create_video_api_v1_videos_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Health
         * @description Public liveness + build probe (no auth): identifies the live build.
         */
        get: operations["health_health_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/version": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Version
         * @description Public build metadata (no auth): version + PR number + commit SHA.
         */
        get: operations["version_version_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** AudioPreflightRequest */
        AudioPreflightRequest: {
            /**
             * Video Language
             * @default
             */
            video_language?: string;
            /** Video Script */
            video_script: string;
            /** Voice Audio Url */
            voice_audio_url?: string | null;
            /**
             * Voice Name
             * @default
             */
            voice_name?: string;
            /**
             * Voice Rate
             * @default 1
             */
            voice_rate?: number;
        };
        /** AudioRequest */
        AudioRequest: {
            /**
             * Video Language
             * @default
             */
            video_language?: string | null;
            /** Video Script */
            video_script: string;
            /**
             * Voice Name
             * @default zh-CN-XiaoxiaoNeural-Female
             */
            voice_name?: string | null;
            /**
             * Voice Rate
             * @default 1.2
             */
            voice_rate?: number | null;
            /**
             * Voice Volume
             * @default 1
             */
            voice_volume?: number | null;
        };
        /** BaseResponse */
        BaseResponse: {
            /** Body */
            body?: unknown;
            /**
             * Message
             * @default success
             */
            message?: string | null;
            /**
             * Status
             * @default 200
             */
            status?: number;
        };
        /**
         * BgmRetrieveResponse
         * @example {
         *       "body": {
         *         "files": [
         *           {
         *             "file": "/post-engineer/resource/songs/output013.mp3",
         *             "name": "output013.mp3",
         *             "size": 1891269
         *           }
         *         ]
         *       },
         *       "message": "success",
         *       "status": 200
         *     }
         */
        BgmRetrieveResponse: {
            /** Body */
            body?: unknown;
            /**
             * Message
             * @default success
             */
            message?: string | null;
            /**
             * Status
             * @default 200
             */
            status?: number;
        };
        /**
         * BgmUploadResponse
         * @example {
         *       "body": {
         *         "file": "/post-engineer/resource/songs/example.mp3"
         *       },
         *       "message": "success",
         *       "status": 200
         *     }
         */
        BgmUploadResponse: {
            /** Body */
            body?: unknown;
            /**
             * Message
             * @default success
             */
            message?: string | null;
            /**
             * Status
             * @default 200
             */
            status?: number;
        };
        /** Body_create_cloned_voice_api_v1_cloned_voices_post */
        Body_create_cloned_voice_api_v1_cloned_voices_post: {
            /** Consent */
            consent: string;
            /** Denoise */
            denoise: string;
            /** File */
            file: string;
            /** Language */
            language: string;
        };
        /** Body_denoise_preview_api_v1_cloned_voices_denoise_preview_post */
        Body_denoise_preview_api_v1_cloned_voices_denoise_preview_post: {
            /** File */
            file: string;
        };
        /** Body_upload_bgm_file_api_v1_musics_post */
        Body_upload_bgm_file_api_v1_musics_post: {
            /** File */
            file: string;
        };
        /** Body_upload_temp_asset_api_v1_temp_assets_post */
        Body_upload_temp_asset_api_v1_temp_assets_post: {
            /** File */
            file: string;
        };
        /** Body_upload_video_material_file_api_v1_video_materials_post */
        Body_upload_video_material_file_api_v1_video_materials_post: {
            /** File */
            file: string;
        };
        /**
         * ClonedVoicePreviewRequest
         * @description Optional JSON body of the preview endpoint: ``{"text": "..."}``.
         *
         *     Only the string type is enforced here — a malformed body or a
         *     non-string text fails pydantic validation, which the app maps to a
         *     400. The trimmed-length check lives in validate_preview_text, so a
         *     string longer than the cap that trims into range is still accepted.
         */
        ClonedVoicePreviewRequest: {
            /** Text */
            text?: string | null;
        };
        /**
         * HouseVoicePreviewRequest
         * @description Optional JSON body of the house preview endpoint: ``{"text": "..."}``.
         *
         *     Only the string type is enforced here — a malformed body or a
         *     non-string text fails pydantic validation, which the app maps to a
         *     400. The trimmed-length check lives in validate_preview_text, so a
         *     string longer than the cap that trims into range is still accepted.
         */
        HouseVoicePreviewRequest: {
            /** Text */
            text?: string | null;
        };
        /** HTTPValidationError */
        HTTPValidationError: {
            /** Detail */
            detail?: components["schemas"]["ValidationError"][];
        };
        /**
         * LipSyncQuality
         * @enum {string}
         */
        LipSyncQuality: "ok" | "very-good";
        /** MaterialInfo */
        MaterialInfo: {
            /**
             * Duration
             * @default 0
             */
            duration?: number;
            /**
             * Provider
             * @default local
             */
            provider?: string;
            /**
             * Url
             * @default
             */
            url?: string;
        };
        /** MediaCheckRequest */
        MediaCheckRequest: {
            /** Media Id */
            media_id?: string | null;
            /** Url */
            url?: string | null;
            video_aspect?: components["schemas"]["VideoAspect"] | null;
        };
        /**
         * PersonaParams
         * @description Inline persona in the job (stateless): refs resolved by the caller.
         *
         *     At most one visual identity (photo_url OR avatar_url — a person in
         *     faceless mode may have zero) and exactly one voice (voice_id OR
         *     voice_audio_url).
         * @example {
         *       "name": "Ana",
         *       "photo_url": "https://supabase.test/signed/foto.png",
         *       "voice_id": "calm"
         *     }
         */
        PersonaParams: {
            /**
             * Audience
             * @default
             */
            audience?: string;
            /** Avatar Url */
            avatar_url?: string | null;
            /**
             * Id
             * @default
             */
            id?: string;
            /**
             * Language
             * @default pt-BR
             */
            language?: string;
            /**
             * Name
             * @default
             */
            name?: string;
            /**
             * Niche
             * @default
             */
            niche?: string;
            /** Photo Url */
            photo_url?: string | null;
            /**
             * Speaking Style
             * @default
             */
            speaking_style?: string;
            /** Voice Audio Url */
            voice_audio_url?: string | null;
            /** Voice Id */
            voice_id?: string | null;
        };
        /** PersonaRequest */
        PersonaRequest: {
            /** Avatar Url */
            avatar_url?: string | null;
            /**
             * Name
             * @default
             */
            name?: string;
            /** Photo Url */
            photo_url?: string | null;
            /** Voice Audio Url */
            voice_audio_url?: string | null;
            /** Voice Id */
            voice_id?: string | null;
        };
        /** ScriptSegment */
        ScriptSegment: {
            /**
             * Kind
             * @enum {string}
             */
            kind: "hook" | "body" | "cta";
            /** Media */
            media?: components["schemas"]["SegmentMedia"][] | null;
            /** Text */
            text: string;
        };
        /**
         * SegmentMedia
         * @description Media reference shape for a segment's photo (upload_media uploads it, check_media verifies it).
         */
        SegmentMedia: {
            /** Mediaid */
            mediaId?: string | null;
            overlay?: components["schemas"]["SegmentOverlay"] | null;
            /** Url */
            url?: string | null;
        };
        /**
         * SegmentOverlay
         * @description Info card painted inside a segment photo's panel: real name, address, price.
         */
        SegmentOverlay: {
            /** Badge */
            badge?: string | null;
            /** Subtitle */
            subtitle?: string | null;
            /** Title */
            title: string;
        };
        /** SubtitleRequest */
        SubtitleRequest: {
            /**
             * Font Name
             * @default BeVietnamPro-Medium.ttf
             */
            font_name?: string | null;
            /**
             * Font Size
             * @default 50
             */
            font_size?: number;
            /**
             * Rounded Subtitle Background
             * @default false
             */
            rounded_subtitle_background?: boolean;
            /**
             * Stroke Color
             * @default #000000
             */
            stroke_color?: string | null;
            /**
             * Stroke Width
             * @default 1.5
             */
            stroke_width?: number;
            /**
             * Subtitle Enabled
             * @default true
             */
            subtitle_enabled?: string | null;
            /**
             * Subtitle Position
             * @default center
             */
            subtitle_position?: string | null;
            /**
             * Text Background Color
             * @default true
             */
            text_background_color?: boolean | string;
            /**
             * Text Fore Color
             * @default #FFFFFF
             */
            text_fore_color?: string | null;
            /**
             * Video Language
             * @default
             */
            video_language?: string | null;
            /** Video Script */
            video_script: string;
            /**
             * Voice Name
             * @default en-US-GuyNeural
             */
            voice_name?: string | null;
            /**
             * Voice Rate
             * @default 1.2
             */
            voice_rate?: number | null;
            /**
             * Voice Volume
             * @default 1
             */
            voice_volume?: number | null;
        };
        /**
         * TaskDeletionResponse
         * @example {
         *       "body": {
         *         "combined_videos": [
         *           "http://127.0.0.1:8080/tasks/6c85c8cc-a77a-42b9-bc30-947815aa0558/combined-1.mp4"
         *         ],
         *         "progress": 100,
         *         "state": 1,
         *         "videos": [
         *           "http://127.0.0.1:8080/tasks/6c85c8cc-a77a-42b9-bc30-947815aa0558/final-1.mp4"
         *         ]
         *       },
         *       "message": "success",
         *       "status": 200
         *     }
         */
        TaskDeletionResponse: {
            /** Body */
            body?: unknown;
            /**
             * Message
             * @default success
             */
            message?: string | null;
            /**
             * Status
             * @default 200
             */
            status?: number;
        };
        /**
         * TaskQueryResponse
         * @example {
         *       "body": {
         *         "combined_videos": [
         *           "http://127.0.0.1:8080/tasks/6c85c8cc-a77a-42b9-bc30-947815aa0558/combined-1.mp4"
         *         ],
         *         "progress": 100,
         *         "state": 1,
         *         "videos": [
         *           "http://127.0.0.1:8080/tasks/6c85c8cc-a77a-42b9-bc30-947815aa0558/final-1.mp4"
         *         ]
         *       },
         *       "message": "success",
         *       "status": 200
         *     }
         */
        TaskQueryResponse: {
            /** Body */
            body?: unknown;
            /**
             * Message
             * @default success
             */
            message?: string | null;
            /**
             * Status
             * @default 200
             */
            status?: number;
        };
        /**
         * TaskResponse
         * @example {
         *       "body": {
         *         "task_id": "6c85c8cc-a77a-42b9-bc30-947815aa0558"
         *       },
         *       "message": "success",
         *       "status": 200
         *     }
         */
        TaskResponse: {
            body: components["schemas"]["TaskResponseBody"];
            /**
             * Message
             * @default success
             */
            message?: string | null;
            /**
             * Status
             * @default 200
             */
            status?: number;
        };
        /** TaskResponseBody */
        TaskResponseBody: {
            /** Task Id */
            task_id: string;
        };
        /** TaskVideoRequest */
        TaskVideoRequest: {
            /**
             * Bgm Volume
             * @default 0.09
             */
            bgm_volume?: number | null;
            /** Custom Audio File */
            custom_audio_file?: string | null;
            /**
             * Custom Position
             * @default 50
             */
            custom_position?: number;
            /**
             * Font Name
             * @default BeVietnamPro-Medium.ttf
             */
            font_name?: string | null;
            /**
             * Font Size
             * @default 50
             */
            font_size?: number;
            /** Generation Id */
            generation_id?: string | null;
            /** Music Mood */
            music_mood?: string | null;
            /**
             * N Threads
             * @default 2
             */
            n_threads?: number | null;
            /** Paragraph Number */
            paragraph_number?: number | null;
            persona?: components["schemas"]["PersonaParams"] | null;
            /** Platform Ids */
            platform_ids?: string[];
            /**
             * Rounded Subtitle Background
             * @default false
             */
            rounded_subtitle_background?: boolean;
            /** Segments */
            segments?: components["schemas"]["ScriptSegment"][] | null;
            /** Slot Id */
            slot_id?: string | null;
            /**
             * Stroke Color
             * @default #000000
             */
            stroke_color?: string | null;
            /**
             * Stroke Width
             * @default 2.5
             */
            stroke_width?: number;
            /**
             * Subtitle Enabled
             * @default true
             */
            subtitle_enabled?: boolean | null;
            /**
             * Subtitle Position
             * @default center
             */
            subtitle_position?: string | null;
            /**
             * Text Background Color
             * @default false
             */
            text_background_color?: boolean | string;
            /**
             * Text Fore Color
             * @default #FFFFFF
             */
            text_fore_color?: string | null;
            /** @default 9:16 */
            video_aspect?: components["schemas"]["VideoAspect"] | null;
            /**
             * Video Clip Duration
             * @default 2
             */
            video_clip_duration?: number | null;
            /** @default random */
            video_concat_mode?: components["schemas"]["VideoConcatMode"] | null;
            /**
             * Video Cta
             * @default
             */
            video_cta?: string;
            /** Video Description */
            video_description: string;
            /**
             * Video Language
             * @default
             */
            video_language?: string | null;
            /** @default standard */
            video_layout?: components["schemas"]["VideoLayout"];
            /** Video Materials */
            video_materials?: components["schemas"]["MaterialInfo"][] | null;
            /** @default ok */
            video_quality?: components["schemas"]["LipSyncQuality"];
            /**
             * Video Script
             * @default
             */
            video_script?: string;
            /** Video Title */
            video_title: string;
            video_transition_mode?: components["schemas"]["VideoTransitionMode"] | null;
            video_type: components["schemas"]["VideoType"];
            /**
             * Voice Name
             * @default
             */
            voice_name?: string | null;
            /**
             * Voice Rate
             * @default 1
             */
            voice_rate?: number | null;
            /**
             * Voice Volume
             * @default 1
             */
            voice_volume?: number | null;
            /** Webhook Url */
            webhook_url?: string | null;
        };
        /** ValidationError */
        ValidationError: {
            /** Context */
            ctx?: Record<string, never>;
            /** Input */
            input?: unknown;
            /** Location */
            loc: (string | number)[];
            /** Message */
            msg: string;
            /** Error Type */
            type: string;
        };
        /**
         * VideoAspect
         * @enum {string}
         */
        VideoAspect: "16:9" | "9:16" | "1:1";
        /**
         * VideoConcatMode
         * @enum {string}
         */
        VideoConcatMode: "random" | "sequential";
        /**
         * VideoLayout
         * @description How the persona is composed with the video material during the hook.
         * @enum {string}
         */
        VideoLayout: "standard" | "react";
        /**
         * VideoMaterialRetrieveResponse
         * @example {
         *       "body": {
         *         "files": [
         *           {
         *             "file": "/post-engineer/resource/videos/example.mp4",
         *             "name": "example.mp4",
         *             "size": 12345678
         *           }
         *         ]
         *       },
         *       "message": "success",
         *       "status": 200
         *     }
         */
        VideoMaterialRetrieveResponse: {
            /** Body */
            body?: unknown;
            /**
             * Message
             * @default success
             */
            message?: string | null;
            /**
             * Status
             * @default 200
             */
            status?: number;
        };
        /**
         * VideoMaterialUploadResponse
         * @example {
         *       "body": {
         *         "file": "/post-engineer/resource/videos/example.mp4"
         *       },
         *       "message": "success",
         *       "status": 200
         *     }
         */
        VideoMaterialUploadResponse: {
            /** Body */
            body?: unknown;
            /**
             * Message
             * @default success
             */
            message?: string | null;
            /**
             * Status
             * @default 200
             */
            status?: number;
        };
        /**
         * VideoTransitionMode
         * @enum {string}
         */
        VideoTransitionMode: "None" | "Shuffle" | "FadeIn" | "FadeOut" | "SlideIn" | "SlideOut";
        /**
         * VideoType
         * @description The one video mode (issue #542 follow-up): it replaces the
         *     faceless / full_lipsync / lipsync_enabled boolean combination.
         *
         *     full_lipsync: the whole narration renders as talking head; a persona
         *         with a photo is required. 8 tokens at face quality ok, 15 at
         *         very_good.
         *     hook_lipsync: lip sync only on the hook, then the agent's images; a
         *         persona with a photo is required. 2 tokens ok, 3 very_good.
         *     faceless: only the agent's images; a persona is optional, and when one
         *         is present only its voice and niche are used, never its face.
         *         1 token.
         * @enum {string}
         */
        VideoType: "full_lipsync" | "hook_lipsync" | "faceless";
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    create_audio_api_v1_audio_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AudioRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    preflight_duration_api_v1_audio_preflight_duration_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AudioPreflightRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_cloned_voices_api_v1_cloned_voices_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BaseResponse"];
                };
            };
        };
    };
    create_cloned_voice_api_v1_cloned_voices_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_create_cloned_voice_api_v1_cloned_voices_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BaseResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_cloned_voice_api_v1_cloned_voices__clone_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                clone_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BaseResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_cloned_voice_api_v1_cloned_voices__clone_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                clone_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BaseResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    preview_cloned_voice_api_v1_cloned_voices__clone_id__preview_post: {
        parameters: {
            query?: {
                language?: string | null;
            };
            header?: never;
            path: {
                clone_id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["ClonedVoicePreviewRequest"] | null;
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    denoise_preview_api_v1_cloned_voices_denoise_preview_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_denoise_preview_api_v1_cloned_voices_denoise_preview_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    download_video_api_v1_download__file_path__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                file_path: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    check_media_api_v1_media_check_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MediaCheckRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_bgm_list_api_v1_musics_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BgmRetrieveResponse"];
                };
            };
        };
    };
    upload_bgm_file_api_v1_musics_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_upload_bgm_file_api_v1_musics_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BgmUploadResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    validate_persona_endpoint_api_v1_personas_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PersonaRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BaseResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_house_voices_endpoint_api_v1_personas_voices_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BaseResponse"];
                };
            };
        };
    };
    preview_house_voice_endpoint_api_v1_personas_voices__voice_id__preview_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                voice_id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["HouseVoicePreviewRequest"] | null;
            };
        };
        responses: {
            /** @description MP3 audio preview */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "audio/mpeg": string;
                };
            };
            /** @description Invalid preview text (empty after trim or over 300 chars) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BaseResponse"];
                };
            };
            /** @description Voice not found in the house catalog */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BaseResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
            /** @description TTS synthesis failed */
            502: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BaseResponse"];
                };
            };
        };
    };
    voice_sample_endpoint_api_v1_personas_voices__voice_id__sample_get: {
        parameters: {
            query?: {
                language?: string;
            };
            header?: never;
            path: {
                voice_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_sample_languages_endpoint_api_v1_personas_voices_sample_languages_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BaseResponse"];
                };
            };
        };
    };
    stream_video_api_v1_stream__file_path__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                file_path: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_subtitle_api_v1_subtitle_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SubtitleRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_all_tasks_api_v1_tasks_get: {
        parameters: {
            query?: {
                page?: number;
                page_size?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskQueryResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_task_api_v1_tasks__task_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Task ID */
                task_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskQueryResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_video_api_v1_tasks__task_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Task ID */
                task_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskDeletionResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    task_events_api_v1_tasks__task_id__events_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Task ID */
                task_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    upload_temp_asset_api_v1_temp_assets_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_upload_temp_asset_api_v1_temp_assets_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_temp_asset_api_v1_temp_assets__name__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                name: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_video_materials_list_api_v1_video_materials_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VideoMaterialRetrieveResponse"];
                };
            };
        };
    };
    upload_video_material_file_api_v1_video_materials_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_upload_video_material_file_api_v1_video_materials_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VideoMaterialUploadResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_video_api_v1_videos_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TaskVideoRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    health_health_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: string | number | null;
                    };
                };
            };
        };
    };
    version_version_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: string | number | null;
                    };
                };
            };
        };
    };
}
