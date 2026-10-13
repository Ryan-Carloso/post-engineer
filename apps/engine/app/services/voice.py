import math
import os
import re
import subprocess
import unicodedata
from typing import Union
from xml.sax.saxutils import unescape

import requests
from loguru import logger
from moviepy.audio.io.AudioFileClip import AudioFileClip
from moviepy.video.tools import subtitles

from app.config import config
from app.utils import utils

NO_VOICE_NAME = "no-voice"
# `none` 是 PR #981 里曾使用过的无配音标识。这里短期兼容这个值，避免
# 已经手动调用过该分支的 API 用户升级后立即失效；WebUI 和新代码统一使用
# 更明确的 `no-voice`。
_NO_VOICE_ALIASES = {NO_VOICE_NAME, "none"}

# 100-nanosecond units per second. The subtitle timeline predates every TTS
# provider and `mktimestamp` is integer-based on it.
SUB_TIME_UNITS_PER_SECOND = 10000000


class SubMaker:
    """Subtitle carrier returned by ``tts``.

    This was ``edge_tts.SubMaker``, which the engine used both as an edge-tts
    transport handle and — via its ``subs``/``offset`` attributes — as the
    timeline ``create_subtitle`` aggregates into an SRT. edge_tts is gone; the
    timeline stays because Chatterbox returns one of these.

    ``subs`` holds the spoken fragments and ``offset`` their (start, end)
    positions in 100-nanosecond units, index-aligned. Chatterbox has no
    word-level boundaries, so the fragments are filled by
    ``populate_legacy_submaker_with_full_text``: one fragment per sentence,
    timed proportionally across the audio duration.
    """

    def __init__(self) -> None:
        self.subs: list[str] = []
        self.offset: list[tuple[int, int]] = []


def _preprocess_text_for_tts(text: str) -> str:
    """
    Preprocess text before sending it to TTS to avoid punctuation being
    spoken aloud.

    Removes periods that Portuguese voices read as "ponto" ("period"),
    while keeping other pause punctuation (commas, exclamation and
    question marks).

    Args:
        text: Original text with punctuation

    Returns:
        Preprocessed text without problematic periods
    """
    if not text:
        return text

    # Remove periods that are not abbreviations.
    # Protects common abbreviations by keeping their periods.
    processed = text

    # Common abbreviations (Portuguese and English) that must keep the
    # period - format: (regex_pattern, replacement_text)
    abbreviations = [
        # Portuguese titles
        (r'\bsr\.', 'Sr.'), (r'\bSr\.', 'Sr.'),
        (r'\bsra\.', 'Sra.'), (r'\bSra\.', 'Sra.'),
        (r'\bdra\.', 'Dra.'), (r'\bDra\.', 'Dra.'),
        (r'\bdr\.', 'Dr.'), (r'\bDr\.', 'Dr.'),
        (r'\bprof\.', 'Prof.'), (r'\bProf\.', 'Prof.'),
        (r'\beng\.', 'Eng.'), (r'\bEng\.', 'Eng.'),
        # Common abbreviations
        (r'\betc\.', 'etc.'),
        (r'\bvs\.', 'vs.'), (r'\bVs\.', 'vs.'),
        (r'\bex\.', 'ex.'), (r'\bEx\.', 'ex.'),
        (r'\bno\.', 'nº.'), (r'\bNo\.', 'Nº.'),
        (r'\bpág\.', 'pág.'), (r'\bp\.', 'p.'),
        # Emails and URLs
        (r'\b[\w\.-]+@[\w\.-]+\.com\b', None),  # Emails ending in .com
        (r'\b[\w\.-]+@[\w\.-]+\.br\b', None),   # Emails ending in .br
        (r'\b[\w\.-]+@[\w\.-]+\.gov\b', None),  # Emails ending in .gov
    ]

    # First, temporarily protect abbreviations
    protected_abbrs = []
    for i, (pattern, replacement) in enumerate(abbreviations):
        placeholder = f"__ABBREV_{i}__"
        # Find all matches and replace them
        matches = list(re.finditer(pattern, processed, flags=re.IGNORECASE))
        for match in reversed(matches):  # Reverse to keep positions correct
            # Use the original match text to preserve capitalization
            original_text = match.group(0)
            protected_abbrs.append((placeholder, original_text))
            processed = processed[:match.start()] + placeholder + processed[match.end():]

    # Preserve sentence punctuation. Providers receive the user's text as
    # written; stripping periods changes meaning and breaks subtitle alignment.
    processed = re.sub(r'\s+', ' ', processed).strip()

    # Restore abbreviations
    for placeholder, original_text in protected_abbrs:
        processed = processed.replace(placeholder, original_text)

    return processed


def _configure_pydub_ffmpeg(audio_segment_cls):
    configured_ffmpeg = utils.get_ffmpeg_binary()
    if configured_ffmpeg:
        audio_segment_cls.converter = configured_ffmpeg


def mktimestamp(time_unit: float) -> str:
    """
    将 edge_tts 使用的 100 纳秒时间单位转换为字幕时间戳。

    edge_tts 7.x 不再导出旧版本里的 `mktimestamp`，但项目里旧字幕链路
    还需要这个格式化函数来兼容 Azure v2、Gemini、SiliconFlow 这些
    手工构造的字幕时间轴，因此这里内置一个等价实现。
    """
    hour = math.floor(time_unit / 10**7 / 3600)
    minute = math.floor((time_unit / 10**7 / 60) % 60)
    seconds = (time_unit / 10**7) % 60
    return f"{hour:02d}:{minute:02d}:{seconds:06.3f}"


def get_elevenlabs_voices(api_key: str) -> list[str]:
    if not api_key:
        return []
    try:
        url = "https://api.elevenlabs.io/v2/voices"
        params = {"is_favorite": "true", "page_size": 100}
        headers = {"xi-api-key": api_key}
        response = requests.get(url, params=params, headers=headers, timeout=10)
        if response.status_code != 200:
            logger.warning(
                f"ElevenLabs voices fetch failed with status {response.status_code}: {response.text}"
            )
            return []
        data = response.json()
        voices = data.get("voices", [])
        return [
            f"elevenlabs:{v['voice_id']}:{v['name']}"
            for v in voices
            if v.get("voice_id") and v.get("name") and v.get("status") != "disabled"
        ]
    except Exception as e:
        logger.warning(f"ElevenLabs voices fetch failed: {str(e)}")
        return []


def get_chatterbox_voices() -> list[str]:
    """Return the configured Chatterbox voices.

    Chatterbox is self-hosted, so there is no global voice catalog. Operators
    list the voice names exposed by their server via ``[chatterbox] voices``
    (a TOML array, or a comma-separated string). Each entry is normalised to
    the ``chatterbox:<name>`` format used by the TTS dispatcher.
    """
    voices = config.chatterbox.get("voices", []) or []
    if isinstance(voices, str):
        voices = [v.strip() for v in voices.split(",") if v.strip()]
    result = []
    for v in voices:
        v = str(v).strip()
        if not v:
            continue
        result.append(v if v.startswith("chatterbox:") else f"chatterbox:{v}")
    if not result:
        # keep the dropdown usable even before any voice is configured
        result = ["chatterbox:default-Female"]
    return result


_AZURE_VOICES_DATA_FILE = os.path.join(
    os.path.dirname(__file__), "data", "azure_voices.json"
)
_azure_voices_cache = None


def parse_voice_name(name: str):
    # zh-CN-XiaoyiNeural-Female
    # zh-CN-YunxiNeural-Male
    # zh-CN-XiaoxiaoMultilingualNeural-V2-Female
    name = name.replace("-Female", "").replace("-Male", "").strip()
    return name

def is_elevenlabs_voice(voice_name: str) -> bool:
    return (voice_name or "").startswith("elevenlabs:")



def is_chatterbox_voice(voice_name: str) -> bool:
    return (voice_name or "").startswith("chatterbox:")


def is_no_voice(voice_name: str | None) -> bool:
    """
    判断用户是否明确选择了“无配音”模式。

    这里刻意不把空字符串当成无配音：空 voice 更可能是配置损坏、旧版本
    WebUI 状态丢失或接口参数缺失。只有明确的 sentinel 才进入静音分支，
    这样可以避免把真实错误伪装成正常生成。
    """
    return str(voice_name or "").strip().lower() in _NO_VOICE_ALIASES


def estimate_no_voice_duration(text: str) -> float:
    """
    为无配音模式估算一个稳定的视频时间轴长度。

    无配音仍需要一个音频占位来驱动现有素材裁剪、字幕时间轴和最终合成。
    估算策略尽量简单：
    1. 中文等 CJK 字符按约 4.2 字/秒估算；
    2. 英文/数字按约 2.7 词/秒估算；
    3. 其他语种文字按约 4.0 字符/秒兜底估算，覆盖俄语、阿拉伯语、
       日文假名、韩文等非 ASCII 文本；
    4. 每个断句补一点停顿，让字幕切换不至于过于紧凑；
    5. 最少 3 秒，避免极短脚本生成 0 秒音频。
    """
    normalized_text = (text or "").strip()
    if not normalized_text:
        return 3.0

    cjk_chars = len(re.findall(r"[\u4e00-\u9fff]", normalized_text))
    words = len(re.findall(r"[A-Za-z0-9]+", normalized_text))
    ascii_word_chars = sum(len(word) for word in re.findall(r"[A-Za-z0-9]+", normalized_text))
    other_text_chars = 0
    for char in normalized_text:
        # Unicode category 以 L 开头表示各语种字母，N 表示数字。前面已经单独
        # 统计了 CJK 和 ASCII 单词，这里只统计剩余文字，避免英文被重复计时。
        category = unicodedata.category(char)
        if category.startswith(("L", "N")):
            other_text_chars += 1
    other_text_chars = max(other_text_chars - cjk_chars - ascii_word_chars, 0)
    sentence_count = max(len(utils.split_string_by_punctuations(normalized_text)), 1)

    cjk_duration = cjk_chars / 4.2
    word_duration = words / 2.7
    other_text_duration = other_text_chars / 4.0
    pause_duration = max(sentence_count - 1, 0) * 0.35
    return max(3.0, cjk_duration + word_duration + other_text_duration + pause_duration)


def generate_silent_audio(duration_seconds: float, output_file: str) -> bool:
    """
    生成 MP3 静音音频，作为“无配音”模式的时间轴占位。

    使用 FFmpeg 的 anullsrc 直接生成静音，比先构造临时 WAV 再转码更少中间
    文件。失败时返回 False，让上层按普通 TTS 失败路径处理并记录日志。
    """
    ensure_file_path_exists(output_file)
    duration_seconds = max(float(duration_seconds or 0), 0.1)
    ffmpeg_binary = utils.get_ffmpeg_binary()
    command = [
        ffmpeg_binary,
        "-y",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=44100:cl=mono",
        "-t",
        f"{duration_seconds:.3f}",
        "-codec:a",
        "libmp3lame",
        "-q:a",
        "4",
        output_file,
    ]

    logger.info(
        f"generating silent audio for no-voice mode, duration: {duration_seconds:.2f}s"
    )
    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        logger.error(
            "failed to generate silent audio: "
            f"{(result.stderr or result.stdout or '').strip()}"
        )
        return False
    if not os.path.exists(output_file) or os.path.getsize(output_file) <= 0:
        logger.error(
            "silent audio output file is missing or empty, "
            f"file: {output_file}, duration: {duration_seconds:.2f}s"
        )
        return False
    return True


def tts(
    text: str,
    voice_name: str,
    voice_rate: float,
    voice_file: str,
    voice_volume: float = 1.0,
    voice_pitch: str = "",
) -> Union[SubMaker, None]:
    if is_no_voice(voice_name):
        duration_seconds = estimate_no_voice_duration(text)
        if not generate_silent_audio(duration_seconds, voice_file):
            return None

        sub_maker = SubMaker()
        return populate_legacy_submaker_with_full_text(
            sub_maker=sub_maker,
            text=text,
            audio_duration_seconds=duration_seconds,
        )

    if is_elevenlabs_voice(voice_name):
        # Format: elevenlabs:<voice_id>
        parts = voice_name.split(":", 1)
        if len(parts) >= 2 and parts[1].strip():
            return elevenlabs_tts(
                text, parts[1].strip(), voice_file, voice_rate, voice_volume
            )
        logger.error(f"Invalid elevenlabs voice name format: {voice_name}")
        return None
    if is_chatterbox_voice(voice_name):
        # Format: chatterbox:<voice>, optionally with a display-only
        # -Female/-Male suffix.
        parts = voice_name.split(":", 1)
        if len(parts) < 2 or not parts[1].strip():
            logger.error(f"Invalid chatterbox voice name format: {voice_name}")
            return None
        chatterbox_voice = parts[1].strip()
        if chatterbox_voice.endswith(("-Female", "-Male")):
            chatterbox_voice = chatterbox_voice.rsplit("-", 1)[0]
        return chatterbox_tts(
            text, chatterbox_voice, voice_file, voice_rate, voice_volume
        )

    # Chatterbox and ElevenLabs are the only providers. An unrecognised voice
    # id used to fall through to `azure_tts_v1(...)`, which turned every typo
    # into a silent edge-tts request that failed as if it were a network
    # problem. Fail loud instead: the caller picked a voice that no longer
    # exists.
    logger.error(
        f"unknown voice: {voice_name!r}. Providers are ElevenLabs "
        "(`elevenlabs:<id>`) and Chatterbox (`chatterbox:<name>`); use the "
        f"explicit {NO_VOICE_NAME!r} sentinel for silence."
    )
    return None


def ensure_file_path_exists(file_path: str) -> None:
    """
    确保输出文件所在目录一定存在。

    这里单独做一层兜底，是因为 edge_tts 7.x 在真正发起网络请求之前，
    就会先打开目标音频文件；如果目录不存在，会直接因为本地文件路径报错，
    从而掩盖真正的 TTS 行为结果。
    """
    dir_path = os.path.dirname(file_path)
    if dir_path:
        os.makedirs(dir_path, exist_ok=True)


def populate_legacy_submaker_with_full_text(
    sub_maker: SubMaker, text: str, audio_duration_seconds: float
) -> SubMaker:
    """
    用整段文本填充 `subs/offset` 字幕结构。

    Chatterbox 不返回逐词边界，所以字幕时间轴只能自己估：按脚本断句切成
    多个片段，再按字符数比例分配时长。这样 `create_subtitle` 才能逐行匹配
    脚本断句，而不是因为整段文本匹配不上而回退 Whisper。

    Args:
        sub_maker: 需要写入字幕数据的对象
        text: 原始脚本文本
        audio_duration_seconds: 音频总时长，单位秒

    Returns:
        已填充字幕数据的 SubMaker 对象
    """
    # 清空旧值，避免调用方重复复用对象时出现脏数据叠加。
    sub_maker.subs = []
    sub_maker.offset = []

    normalized_text = (text or "").strip()
    if not normalized_text:
        return sub_maker

    audio_duration_100ns = max(int(audio_duration_seconds * 10000000), 1)

    # Gemini / SiliconFlow 这类路径拿不到逐词边界时，仍然尽量沿用项目
    # 原来的“按标点断句 + 按字符数比例分配时长”的策略。这样既能让
    # create_subtitle() 匹配脚本断句，也能避免再次回退 Whisper。
    sentences = utils.split_string_by_punctuations(normalized_text)
    if not sentences:
        sentences = [normalized_text]

    total_chars = sum(len(sentence) for sentence in sentences)
    if total_chars <= 0:
        sub_maker.subs.append(normalized_text)
        sub_maker.offset.append((0, audio_duration_100ns))
        return sub_maker

    current_offset = 0
    for index, sentence in enumerate(sentences):
        cleaned_sentence = sentence.strip()
        if not cleaned_sentence:
            continue

        # 前面的句子按字符数比例分配时长，最后一句兜底吃掉剩余时长，
        # 避免整数取整导致总时长丢失或字幕结束时间短于音频。
        if index == len(sentences) - 1:
            sentence_end = audio_duration_100ns
        else:
            sentence_chars = len(cleaned_sentence)
            sentence_duration = max(
                int(audio_duration_100ns * (sentence_chars / total_chars)),
                1,
            )
            sentence_end = min(current_offset + sentence_duration, audio_duration_100ns)

        sub_maker.subs.append(cleaned_sentence)
        sub_maker.offset.append((current_offset, sentence_end))
        current_offset = sentence_end

    return sub_maker
def elevenlabs_tts(
    text: str,
    voice_id: str,
    voice_file: str,
    voice_rate: float = 1.0,
    voice_volume: float = 1.0,
    model_id: str = "",
) -> Union[SubMaker, None]:
    text = (text or "").strip()
    if not text:
        logger.error("ElevenLabs TTS text is empty")
        return None

    # Preprocess text to avoid TTS reading "ponto" ("period") in Portuguese
    text = _preprocess_text_for_tts(text)
    api_key = config.elevenlabs.get("api_key", "")
    if not api_key:
        logger.error("ElevenLabs API key is not set")
        return None

    if not model_id:
        model_id = config.elevenlabs.get("model_id", "eleven_multilingual_v2")

    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
    headers = {
        "xi-api-key": api_key,
        "Content-Type": "application/json",
    }
    payload = {
        "text": text,
        "model_id": model_id,
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.75,
            "style": 0.0,
            "use_speaker_boost": True,
        },
    }

    # Errors where retrying will never help (auth/access/validation failures).
    _NON_RETRYABLE_CODES = {401, 403, 422}
    _NON_RETRYABLE_STATUSES = {"voice_disabled", "voice_access_denied", "unauthorized"}

    for i in range(3):
        try:
            logger.info(f"start elevenlabs tts, voice_id: {voice_id}, try: {i + 1}")
            ensure_file_path_exists(voice_file)

            response = requests.post(url, json=payload, headers=headers, timeout=60)
            if response.status_code != 200:
                error_status = ""
                try:
                    detail = response.json().get("detail", {})
                    if isinstance(detail, dict):
                        error_status = detail.get("status", "")
                except Exception:
                    pass

                if response.status_code in _NON_RETRYABLE_CODES or error_status in _NON_RETRYABLE_STATUSES:
                    logger.error(
                        f"ElevenLabs TTS failed (non-retryable) — voice_id: {voice_id}, "
                        f"status: {response.status_code}, error: {error_status or response.text[:200]}. "
                        "Please select a different ElevenLabs voice."
                    )
                    return None

                logger.error(
                    f"elevenlabs tts failed with status {response.status_code}: {response.text[:200]}"
                )
                continue

            with open(voice_file, "wb") as f:
                f.write(response.content)

            audio_clip = AudioFileClip(voice_file)
            audio_duration = audio_clip.duration
            audio_clip.close()

            sub_maker = SubMaker()
            logger.success(f"elevenlabs tts succeeded: {voice_file}")
            return populate_legacy_submaker_with_full_text(
                sub_maker=sub_maker,
                text=text,
                audio_duration_seconds=audio_duration,
            )
        except Exception as e:
            logger.error(f"elevenlabs tts failed: {str(e)}")

    return None




def chatterbox_tts(
    text: str,
    voice: str,
    voice_file: str,
    voice_rate: float = 1.0,
    voice_volume: float = 1.0,
    model_id: str = "",
) -> Union[SubMaker, None]:
    """Generate speech with a self-hosted Chatterbox TTS server.

    Chatterbox (Resemble AI, MIT) is an open-source, locally hosted TTS model
    with zero-shot voice cloning — a self-hostable alternative to ElevenLabs.
    This talks to an OpenAI-compatible ``/audio/speech`` endpoint, so it works
    with the common community servers (e.g. devnen/Chatterbox-TTS-Server,
    travisvn/chatterbox-tts-api). Configure ``[chatterbox] base_url`` (and an
    optional ``api_key``).

    Like ElevenLabs, Chatterbox does not return word-level timestamps, so the
    subtitle path falls back to the full-text SubMaker. For tighter subtitle
    sync set ``subtitle_provider = "whisper"``.
    """
    text = (text or "").strip()
    if not text:
        logger.error("Chatterbox TTS text is empty")
        return None

    # Preprocess text to avoid TTS reading "ponto" ("period") in Portuguese
    text = _preprocess_text_for_tts(text)
    base_url = (config.chatterbox.get("base_url", "") or "").strip().rstrip("/")
    if not base_url:
        logger.error(
            "Chatterbox base_url is not set, please configure [chatterbox] base_url in config.toml"
        )
        return None

    api_key = config.chatterbox.get("api_key", "")
    if not model_id:
        model_id = config.chatterbox.get("model_id", "chatterbox") or "chatterbox"

    url = f"{base_url}/audio/speech"
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    payload = {
        "model": model_id,
        "input": text,
        "voice": voice,
        "response_format": "mp3",
        # OpenAI speech API accepts speed 0.25-4.0; MoneyPrinterTurbo's rate is a
        # 1.0-centred multiplier, so it maps directly (clamped to the valid range).
        "speed": max(0.25, min(4.0, float(voice_rate or 1.0))),
    }
    # voice_volume is accepted for parity with the other TTS providers but is
    # intentionally not sent: the OpenAI /audio/speech contract has no volume
    # field, so Chatterbox servers ignore it. Adjust loudness via voice_rate
    # (speed) or in post-processing instead.

    for i in range(3):
        try:
            logger.info(f"start chatterbox tts, voice: {voice}, try: {i + 1}")
            ensure_file_path_exists(voice_file)

            response = requests.post(url, json=payload, headers=headers, timeout=120)
            if response.status_code != 200:
                logger.error(
                    f"chatterbox tts failed with status {response.status_code}: {response.text[:200]}"
                )
                continue

            with open(voice_file, "wb") as f:
                f.write(response.content)

            audio_clip = AudioFileClip(voice_file)
            audio_duration = audio_clip.duration
            audio_clip.close()

            sub_maker = SubMaker()
            logger.success(f"chatterbox tts succeeded: {voice_file}")
            return populate_legacy_submaker_with_full_text(
                sub_maker=sub_maker,
                text=text,
                audio_duration_seconds=audio_duration,
            )
        except Exception as e:
            logger.error(f"chatterbox tts failed: {str(e)}")

    return None


def _format_text(text: str) -> str:
    """
    清理字幕对齐前的脚本文本。

    这里不能只在 LLM 生成阶段处理，因为用户也可能手动粘贴脚本，或通过
    API 直接传入包含 Markdown 标记的文本。TTS 通常不会朗读 `---`、
    `___`、`***` 这类分隔符行，也不会朗读 `_` 这种强调标记；如果字幕
    对齐仍保留这些字符，`create_subtitle()` 会一直等待不存在的 cue，
    最终导致字幕文件缺失并在 Whisper fallback 校正时补出全 0 时间轴。
    """
    text = text.replace("[", " ")
    text = text.replace("]", " ")
    text = text.replace("(", " ")
    text = text.replace(")", " ")
    text = text.replace("{", " ")
    text = text.replace("}", " ")
    return utils.normalize_script_for_subtitle_matching(text)


def _split_subtitle_line(text: str, max_words: int = 10) -> list[str]:
    """Split a long subtitle line into smaller readable chunks."""
    words = [word for word in text.split() if word]
    if len(words) <= max_words:
        return [text.strip()] if text.strip() else []

    chunks: list[str] = []
    current: list[str] = []
    for word in words:
        current.append(word)
        if len(current) >= max_words:
            chunks.append(" ".join(current).strip())
            current = []
    if current:
        chunks.append(" ".join(current).strip())
    return chunks


def _split_subtitle_lines(text: str) -> list[str]:
    """Split script text by punctuation and cap each subtitle chunk length."""
    raw_lines = utils.split_string_by_punctuations(text)
    split_lines: list[str] = []
    for line in raw_lines:
        split_lines.extend(_split_subtitle_line(line, max_words=10))
    return split_lines


def _build_subtitle_formatter():
    """
    返回统一的 SRT 行格式化函数。

    这里单独拆成一个小工具，是为了让 edge_tts 7.x 的 cues 路径
    和项目原有的 legacy `subs/offset` 路径共用同一套字幕落盘格式，
    避免两套逻辑各自产生细微格式差异。
    """

    def formatter(idx: int, start_time: float, end_time: float, sub_text: str) -> str:
        start_t = mktimestamp(start_time).replace(".", ",")
        end_t = mktimestamp(end_time).replace(".", ",")
        return f"{idx}\n{start_t} --> {end_t}\n{sub_text}\n"

    return formatter


# 阿拉伯语变音符号和 Tatweel 拉长符在 edge-tts 返回文本中可能出现，
# 这些字符不影响语义，但会导致脚本文本和字幕 cue 字符串精确匹配失败。
_ARABIC_DIACRITICS = re.compile("[\u0610-\u061A\u064B-\u065F\u0670\u0640\u06D6-\u06ED]")


def _normalize_arabic(text: str) -> str:
    """统一阿拉伯语常见字母变体，提升字幕 cue 与脚本行的匹配容错率。

    edge-tts 对阿拉伯语可能返回与原脚本不同的字母形态，例如把 أ/إ/آ
    归一成 ا，或者携带变音符号。这里仅在最后一层匹配兜底中使用，
    不改变原始字幕文本，避免影响最终展示内容。
    """
    text = _ARABIC_DIACRITICS.sub("", text)
    for src, dst in (
        ("أإآٱ", "ا"),
        ("ىئ", "ي"),
        ("ة", "ه"),
        ("ؤ", "و"),
    ):
        for ch in src:
            text = text.replace(ch, dst)
    return text


def _match_script_line(script_lines: list[str], current_text: str, sub_index: int) -> str:
    """
    尝试把当前累计的字幕文本，与脚本中的某一条标准断句匹配起来。

    这里复用了项目原有的“按标点拆脚本，再逐段比对”的思路：
    1. 优先精确匹配；
    2. 再做一次去标点和 Markdown `_` 格式符后的匹配；
    3. 最后做一次阿拉伯语字符形态归一化匹配。

    这样可以兼容：
    - TTS 返回里可能缺失或单独拆分的标点；
    - 中文场景下词边界和脚本文本不完全一一对应的情况。
    """
    if len(script_lines) <= sub_index:
        return ""

    target_line = script_lines[sub_index]
    if current_text == target_line:
        return target_line.strip()

    current_text_normalized = re.sub(r"[_\W]+", "", current_text)
    target_line_normalized = re.sub(r"[_\W]+", "", target_line)
    if current_text_normalized == target_line_normalized:
        return target_line.strip()

    # 最后一层阿拉伯语容错：edge-tts 返回的字母形态、变音符号或 Tatweel
    # 可能和脚本不同。只在常规匹配失败后归一化比较，非阿拉伯语文本不会受影响。
    current_ar = re.sub(r"[_\W]+", "", _normalize_arabic(current_text))
    target_ar = re.sub(r"[_\W]+", "", _normalize_arabic(target_line))
    if current_ar and current_ar == target_ar:
        return target_line.strip()

    return ""


def _write_subtitle_items(sub_items: list[str], subtitle_file: str) -> bool:
    """
    将已经聚合好的字幕段写入到 SRT 文件，并做一次基本可读性验证。

    返回值：
    - `True`：字幕文件成功落盘且可被 moviepy 解析；
    - `False`：字幕文件写入或解析失败。
    """
    try:
        ensure_file_path_exists(subtitle_file)
        with open(subtitle_file, "w", encoding="utf-8") as file:
            file.write("\n".join(sub_items) + "\n")

        sbs = subtitles.file_to_subtitles(subtitle_file, encoding="utf-8")
        duration = max([tb for ((ta, tb), txt) in sbs]) if sbs else 0
        logger.info(
            f"completed, subtitle file created: {subtitle_file}, duration: {duration}"
        )
        return True
    except Exception as e:
        logger.error(f"failed, error: {str(e)}")
        if os.path.exists(subtitle_file):
            os.remove(subtitle_file)
        return False


def _build_subtitle_items_from_legacy_submaker(
    sub_maker: SubMaker, script_lines: list[str]
) -> list[str]:
    """
    将项目原有 `subs/offset` 结构聚合为按脚本断句的 SRT 片段。

    这部分保留了原来的核心思路，只是拆成独立函数，便于与 edge_tts 7.x
    的 cues 聚合逻辑共享同一套断句匹配与落盘流程。
    """
    formatter = _build_subtitle_formatter()
    start_time = -1.0
    sub_items = []
    sub_index = 0
    sub_line = ""

    legacy_offsets = getattr(sub_maker, "offset", [])
    legacy_subs = getattr(sub_maker, "subs", [])
    for _, (offset, sub) in enumerate(zip(legacy_offsets, legacy_subs)):
        current_start_time, current_end_time = offset
        if start_time < 0:
            start_time = current_start_time

        sub_line += unescape(sub)
        matched_text = _match_script_line(script_lines, sub_line, sub_index)
        if not matched_text:
            continue

        sub_index += 1
        sub_items.append(
            formatter(
                idx=sub_index,
                start_time=start_time,
                end_time=current_end_time,
                sub_text=matched_text,
            )
        )
        start_time = -1.0
        sub_line = ""

    if sub_line.strip():
        logger.warning(
            f"legacy subtitle items still have unmatched text after aggregation: {sub_line}"
        )

    return sub_items


def create_subtitle(sub_maker: SubMaker, text: str, subtitle_file: str):
    """
    优化字幕文件
    1. 将字幕文件按照标点符号分割成多行
    2. 逐行匹配字幕文件中的文本
    3. 生成新的字幕文件
    """
    text = _format_text(text)
    script_lines = _split_subtitle_lines(text)
    try:
        sub_items = _build_subtitle_items_from_legacy_submaker(
            sub_maker, script_lines
        )

        if len(sub_items) != len(script_lines):
            logger.warning(
                f"failed, sub_items len: {len(sub_items)}, script_lines len: {len(script_lines)}"
            )
            return

        _write_subtitle_items(sub_items, subtitle_file)
    except Exception as e:
        logger.error(f"failed, error: {str(e)}")


def _get_audio_duration_from_submaker(sub_maker: SubMaker):
    """Audio duration carried by the subtitle timeline, in seconds."""
    offsets = sub_maker.offset
    if not offsets:
        return 0.0
    return offsets[-1][1] / SUB_TIME_UNITS_PER_SECOND


def _get_audio_duration_from_file(audio_file: str) -> float:
    """Get the duration of an audio file via moviepy (any ffmpeg-readable format)."""
    if not os.path.exists(audio_file):
        logger.error(f"Audio file does not exist: {audio_file}")
        return 0.0

    try:
        with AudioFileClip(audio_file) as audio:
            return audio.duration  # Duration in seconds
    except Exception as e:
        logger.error(f"Failed to get audio duration from {audio_file}: {str(e)}")
        return 0.0


# Back-compat alias: the reader never was MP3-specific.
_get_audio_duration_from_mp3 = _get_audio_duration_from_file


def get_audio_duration(target: Union[str, SubMaker]) -> float:
    """Get audio duration.

    Accepts a SubMaker or a path to any ffmpeg-readable audio file
    (mp3, wav, m4a, ...). Custom audio uploads are not MP3-only, so the
    extension must not gate the reader.
    """
    if isinstance(target, SubMaker):
        return _get_audio_duration_from_submaker(target)
    elif isinstance(target, str):
        return _get_audio_duration_from_file(target)
    else:
        logger.error(f"Invalid target type: {type(target)}")
        return 0.0

