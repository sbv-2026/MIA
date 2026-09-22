# MIAAssistant

## Chọn model Gemini hoặc GLM

Đặt `MIA_MODEL_PROVIDER=glm` hoặc `MIA_MODEL_PROVIDER=gemini` trong `.env`, rồi khởi động lại Agent API (`docker compose up -d --build` nếu dùng Compose). Cùng một lựa chọn được dùng cho tư vấn lỗi, suy luận/điều hướng và bóc tách PO để lập LC. API key chỉ nằm ở backend.

| Provider | Biến cần cấu hình |
| --- | --- |
| GLM | `MIA_GLM_BASE_URL`, `MIA_GLM_API_KEY`, `MIA_GLM_MODEL` (tùy chọn `MIA_GLM_API_STYLE`, mặc định Chat Completions) |
| Gemini | `MIA_GEMINI_API_KEY`, `MIA_GEMINI_MODEL` (tùy chọn `MIA_GEMINI_BASE_URL`; mặc định endpoint OpenAI-compatible của Google) |

`MIA_MODEL_TIMEOUT_SECONDS` dùng chung. Cấu hình GLM cũ qua `MIA_MODEL_BASE_URL`, `MIA_MODEL_API_KEY`, `MIA_MODEL_NAME` vẫn hoạt động nếu chưa đặt biến `MIA_GLM_*`. Gemini chỉ đọc key/model `MIA_GEMINI_*` để tránh dùng nhầm thông tin đăng nhập GLM. Provider `openai` và `external-model` tiếp tục dùng bộ biến `MIA_MODEL_*` hiện có. Xem [tài liệu Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai) để chọn model và endpoint phù hợp.

Ứng dụng Trợ lý độc lập gồm Assistant Web, Agent API và các integration SDK dùng chung cho DemoMSBWeb/DemoMSBApp.

```powershell
npm install
npm run build
python -m pip install -e ".\services\agent-api[test]"
python -m pytest services\agent-api\tests
docker compose up --build
```

Assistant: <http://localhost:8090/assistant/>. API bắt buộc nhận `contextSnapshot`; project này không có API giao dịch Host.

Khi demo qua Wi-Fi, giữ Assistant/Gateway ở cổng `8090`, rồi truy cập Assistant bằng `http://<IP_LAPTOP>:8090/assistant/`. MIA cho phép mọi host nhúng iframe và gọi API, không cần cấu hình origin. DemoMSBWeb và DemoMSBApp phải cùng trỏ về địa chỉ này; sandbox standalone ở cổng 8080 không nằm trong luồng tích hợp này.

## Gợi ý leo thang và model ngoài

Bubble đọc suggestions và suggestionFlow từ config/knowledge/advisory-knowledge.yaml. Luồng mặc định là giải thích → nói kỹ hơn → **Làm rõ thêm**. Chỉ action clarify gọi model ngoài; nếu gateway chưa cấu hình hoặc lỗi, Agent trả lại hướng dẫn đã publish.

Với provider `openai`, gateway yêu cầu usage trong stream. Với `glm` hoặc API tương thích OpenAI khác, gateway không gửi `stream_options` để tránh lỗi 400 ở provider chưa hỗ trợ; token streaming vẫn dùng chuẩn Chat Completions SSE.

Sao chép .env.example thành .env. Dùng MIA_MODEL_API_STYLE=responses cho OpenAI Responses API, hoặc chat-completions cho GLM/API tương thích OpenAI. API key chỉ được dùng ở backend.

Có thể bổ sung từ/cụm từ thể hiện cảm xúc tiêu cực bằng `MIA_EMOTION_PHRASES`, phân tách từng mục bằng dấu `;` (ví dụ `ngán quá;phát bực;không thể chịu nổi`). Danh sách này được cộng với bộ từ mặc định và có hiệu lực sau khi khởi động lại dịch vụ.

## VieNeu Cloud realtime TTS

Mặc định `MIA_VIENEU_TTS_ENABLED=false`, web tiếp tục dùng giọng của trình duyệt. Để bật VieNeu Cloud realtime cho Chrome và Safari, cấu hình trong `.env` rồi khởi động lại Assistant:

```env
MIA_VIENEU_TTS_ENABLED=true
VIENEU_API_KEY=vn_sk_...
VIENEU_API_BASE_URL=https://api.vieneu.io/api/v1
VIENEU_TTS_URL=https://api.vieneu.io/api/v1/audio/speech
VIENEU_MODEL=vieneu-v4
VIENEU_VOICE=Quang Định
VIENEU_VOICE_MALE=Quang Định
VIENEU_VOICE_FEMALE=Mai An
MIA_VIENEU_TTS_ALLOWED_ORIGINS=http://localhost:8081,http://127.0.0.1:8081
```

API key chỉ được gửi từ Agent API tới VieNeu và không xuất hiện trong cấu hình trả cho browser. Proxy `/api/tts/vieneu/stream` gọi endpoint OpenAI-compatible của VieNeu và Chrome/Safari giải mã luồng WAV trả về. User Nam dùng `VIENEU_VOICE_MALE`, user Nữ dùng `VIENEU_VOICE_FEMALE`; user Không xác định hoặc chưa khai báo dùng `VIENEU_VOICE`. Trình duyệt khác, flag OFF, thiếu key, lỗi cloud hoặc audio bị chặn trước khi phát đều fallback về Web Speech API. Thêm origin triển khai thực tế vào `MIA_VIENEU_TTS_ALLOWED_ORIGINS` trước khi bật.

Khi làm rõ, POST /api/agent/chat phát SSE theo thứ tự: trace, nhiều event token, usage nếu provider hỗ trợ, response, rồi done. Nếu upstream lỗi sẽ có model_error trước response fallback. Browser chỉ nhận output delta và metadata provider/model, không nhận API key, snapshot hoặc form payload.

Sau khi chỉnh YAML, gọi POST /api/config/advisory-knowledge/reload để kích hoạt mà không cần build lại.

Xem [kiến trúc](docs/architecture.md), [versioning](docs/contracts-versioning.md) và [integration stack](docs/deployment.md).
