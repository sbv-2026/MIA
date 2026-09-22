# Cấu hình MIA và dữ liệu người dùng

Kịch bản: [mia-scenarios.md](mia-scenarios.md). Contracts nguồn thuộc MIAAssistant; Host tích hợp artifacts versioned, không sửa bản schema cục bộ.

## 1. Bảng user — DemoMSBWeb

File `DemoMSBWeb/config/demo-users.yaml`, biến môi trường `DEMO_USERS_CONFIG`. MVP dùng YAML, chưa có database/Admin UI.

| Trường | Kiểu/giá trị | Quy tắc |
|---|---|---|
| username | string | Bắt buộc, duy nhất sau trim, khớp phân biệt hoa/thường |
| name | string | Bắt buộc, không rỗng sau trim, tối đa 100 ký tự |
| gender | Nam / Nữ / Không xác định | Không suy đoán từ tên |

```yaml
version: "1.0"
users:
  - username: minh
    name: Minh
    gender: Nam
  - username: lan
    name: Lan
    gender: Nữ
```

Nam → address “anh Minh”, pronoun “anh”; Nữ → “chị Lan”, “chị”. Không khai báo hoặc Không xác định → “anh/chị” cho cả hai trường, không đọc tên. User chưa khai báo vẫn được login demo và displayName giao diện là “Khách hàng”; bảng này không cấp quyền đăng nhập.

Tra cứu chỉ tại backend khi tạo phiên. Kết quả cố định trong phiên. Cấu hình thiếu tên/trùng user/gender sai bị từ chối; reload lỗi giữ bản active.

## 2. Dữ liệu khách hàng — DemoMSBWeb

File `DemoMSBWeb/config/demo-assistant-data.yaml`, biến `DEMO_ASSISTANT_DATA_CONFIG`.

```yaml
version: "1.0"
customers:
  minh:
    todoList:
      - { id: approval-1, todoType: approval }
      - { id: document-1, todoType: documents }
    offeringIds: [business-credit]
```

Mỗi item là một việc còn cần làm; ID duy nhất trong khách hàng. Đây là dữ liệu mô phỏng, không thể hiện kết quả giao dịch thật. User không có customer data nhận danh sách rỗng. Dữ liệu demo được chụp tại login, cấu hình mới áp dụng phiên mới.

`POST /api/config/demo-users/reload` validate đồng thời bảng user và customer data rồi swap active; lỗi trả 422, không đổi active. Endpoint phục vụ profile demo, chưa phải Admin API có authentication production.

`GET /api/host/assistant-data/{sessionId}` trả:

```json
{
  "sessionId": "demo-example",
  "recipient": { "address": "anh Minh", "pronoun": "anh" },
  "todoList": [{ "id": "approval-1", "todoType": "approval" }],
  "offeringIds": ["business-credit"],
  "capturedAt": "2026-09-16T10:00:00Z"
}
```

Không trả bảng users, username hay gender. Phiên không tồn tại/đã logout trả 404, lỗi tải không biến thành danh sách rỗng. Demo session ID chưa thay thế cơ chế auth production. Logout: `DELETE /api/demo/session/{sessionId}` xóa dữ liệu phiên và context/lỗi.

## 3. Cấu hình hội thoại — MIAAssistant

File `config/knowledge/mia-scenarios.yaml`, biến `MIA_SCENARIO_CONFIG`. Chỉ status published được active.

- maxSpokenTodoTypes: số nguyên dương, mặc định 2, tối đa 100.
- todoTypes: todoType duy nhất, todoName, priority, enabled và screenId đích.
- priority lớn được chọn trước, hòa theo định danh; enabled=false chỉ loại khỏi phần đọc chủ động.
- offerings: ID, productName, description, details, priority, validFrom, validUntil có timezone và khoảng thời gian hợp lệ.
- guides: screenId, operation, topic, steps; nguồn citation là section/topic và version file cấu hình.
- templates: greeting, todos, offering, error, confirm, guideHome. Placeholder đúng mẫu, không dùng format specifier/conversion.

```yaml
maxSpokenTodoTypes: 2
todoTypes:
  - { todoType: approval, todoName: phê duyệt, priority: 30, enabled: true, screenId: domestic-disbursement-create }
```

Không khai báo todoType/offering ID đang được dữ liệu khách hàng tham chiếu thì bootstrap trả lỗi rõ ràng. screenId không có trong danh mục Host sẽ không được điều hướng; danh sách vẫn có thể được xem và thông báo tính năng chưa hỗ trợ.

Reload: `POST /api/config/mia-scenarios/reload`; cấu hình không hợp lệ giữ bản gần nhất. Knowledge lỗi riêng giữ ở advisory-knowledge.yaml và endpoint reload hiện có.

## 4. Data flow và interfaces

Banking API → Host → bridge dữ liệu kịch bản → Agent API. recipient không nằm trong ContextSnapshot hoặc prompt model. API validate lại phiên, dữ liệu, freshness và context. History model chỉ dùng description/steps đã tư vấn, giữ riêng theo lỗi/phiên; lời dẫn cá nhân hóa ghép sau model.

- `POST /api/agent/bootstrap`: sessionId, contextSnapshot, assistantData, features; trả utterances có delayMs/hideAfterMs và suggestions.
- `POST /api/agent/chat`: giữ SSE response/done; thêm assistantData/features/actionId tùy chọn cho consumer kịch bản.
- actionId có nhóm todos, offering, guide, navigate và advisory; nút dùng ID, không dựa vào label.
- features do Host công bố chỉ gồm routeId/screenId/name/aliases thực sự hỗ trợ. Không nhận URL tùy ý.
- `POST /api/agent/session/clear`: xóa lịch sử tư vấn của phiên với request cùng cấu trúc chat/context hợp lệ.

Bridge context giữ wire 1.0. Extension scenario wire 1.1 có handshake riêng; chỉ Host opt-in qua scenarioVersion=1.1 mới nhận dữ liệu/state/voice/navigation mới. Packages 0.2.0 hỗ trợ cả hai; không gửi payload 1.1 cho consumer 1.0.

## 5. Voice, bật/tắt và vận hành

Web: `MIA_SCENARIOS_ENABLED=false` trong DemoMSBWeb tắt extension, giữ entry chat 1.0. Mobile: `EXPO_PUBLIC_MIA_SCENARIOS_ENABLED=false` có hiệu lực khi build/bundle mới.

Mobile cài expo-speech ~57.0.3 và expo-speech-recognition 57.x; quyền micro/speech recognition đã khai báo trong app.json và native projects. Cần rebuild native sau khi thay dependencies; binary chưa có module giữ text fallback qua lazy loading. iOS cần cập nhật pods trên macOS trước khi build.

API TTS theo [Expo Speech](https://docs.expo.dev/versions/latest/sdk/speech/); STT theo [expo-speech-recognition](https://github.com/jamsch/expo-speech-recognition). Chỉ request permissions khi khách hàng bật micro. Khả năng vi-VN phụ thuộc voice/service cài trên thiết bị; lỗi không chặn Host.

Không log recipient/todoList/snapshot thô hoặc gửi tên vào model prompt. Các endpoint reload là công cụ demo; database, Admin auth/RBAC và nguồn dữ liệu thật thuộc giai đoạn sau.
