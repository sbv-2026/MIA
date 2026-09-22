# Cấu hình AgentBase Runtime

Console AgentBase yêu cầu cổng 8080 và health check `/health`. Dockerfile.greennode và Agent API đã hỗ trợ cấu hình này. Build/push lại với tag mới để runtime nhận các thay đổi.

## Lệnh và Args

Lệnh (ENTRYPOINT), mỗi dòng một phần tử:

```text
uvicorn
```

Args (CMD), mỗi dòng một phần tử:

```text
app.main:app
--host
0.0.0.0
--port
8080
```

## Biến môi trường

Nhập từng biến thành một cặp Key/Value. Không đưa các biến vào Command/Args. Runtime không tự đọc `.env` trên laptop.

| Key | Value |
|---|---|
| MIA_MODEL_PROVIDER | glm |
| MIA_MODEL_BASE_URL | https://maas-llm-aiplatform-hcm.api.vngcloud.vn/v1 |
| MIA_MODEL_API_KEY | Giá trị khóa trong `.env`, nhập kín trên console |
| MIA_MODEL_NAME | z-ai/glm-5.2-hackathon |
| MIA_MODEL_API_STYLE | chat-completions |
| MIA_MODEL_TIMEOUT_SECONDS | 45 |
| MIA_SUPPORT_DB | /app/data/support.sqlite3 |
| ADVISORY_KNOWLEDGE_CONFIG | /app/config/knowledge/advisory-knowledge.yaml |
| MIA_SCENARIO_CONFIG | /app/config/demo-mia-scenarios.yaml, nếu đã copy file kịch bản vào image theo DOCKER_PUSH.md |

Để dùng Gemini trên runtime, đặt `MIA_MODEL_PROVIDER=gemini`, `MIA_GEMINI_API_KEY` và `MIA_GEMINI_MODEL` (ví dụ `gemini-2.5-flash`). `MIA_GEMINI_BASE_URL` mặc định là `https://generativelanguage.googleapis.com/v1beta/openai/`. Có thể giữ các biến GLM cũ để đổi lại provider sau này; Gemini không sử dụng key GLM. Với GLM, có thể chuyển sang `MIA_GLM_BASE_URL`, `MIA_GLM_API_KEY`, `MIA_GLM_MODEL`; các biến `MIA_MODEL_*` ở bảng vẫn được hỗ trợ.

Thêm các biến MIA_SUPPORT_SMTP_*, MIA_SUPPORT_EMAIL_FROM, MIA_SUPPORT_EMAIL_TO, MIA_SUPPORT_ZALO_WEBHOOK_URL, MIA_SUPPORT_ZALO_TOKEN từ `.env` nếu dùng gửi hồ sơ hỗ trợ. Mount storage cho `/app/data` nếu cần lưu hồ sơ qua redeploy; storage phải cho UID 10001 ghi dữ liệu.

Không thêm GREENNODE_CLIENT_ID, GREENNODE_CLIENT_SECRET, GREENNODE_AGENT_IDENTITY: console dành riêng các tên này. ASSISTANT_URL, MIA_SUPPORT_ASSISTANT_API_URL và các biến của DemoMSBWeb thuộc runtime host, không đặt tại runtime MIAAssistant.

## Permission denied: 'app/data'

Nếu log ghi `PermissionError: [Errno 13] Permission denied: 'app/data'`, kiểm tra giá trị `MIA_SUPPORT_DB` trên console Runtime. Giá trị đúng là `/app/data/support.sqlite3`, có dấu `/` đầu tiên, nhập không kèm dấu nháy.

`app/data/support.sqlite3` là đường dẫn tương đối. Với WORKDIR `/app/services/agent-api` trong Dockerfile.greennode, nó trỏ tới `/app/services/agent-api/app/data`; thư mục mã nguồn thuộc root nên user miaassistant không thể tạo thư mục ở đây. Dockerfile chỉ cấp quyền ghi cho `/app/data`.

Sửa biến môi trường rồi lưu và redeploy Runtime. Nếu image đang dùng đã có ENV và lệnh tạo/cấp quyền `/app/data` như Dockerfile.greennode hiện tại, không cần build/push lại chỉ để sửa biến này. Biến môi trường trên Runtime ghi đè giá trị mặc định trong image.

Nếu sau đó log chuyển sang lỗi tại `/app/data`, kiểm tra storage mount có bật read-only hay không và quyền ghi của UID 10001 trên storage. Mount có thể che thư mục đã được cấp quyền trong image; chown khi build không sửa quyền của storage được mount sau đó. Không cần cấp quyền ghi cho toàn bộ thư mục mã nguồn.
