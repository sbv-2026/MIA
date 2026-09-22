# Contract và versioning

- Context wire giữ `1.0`; scenario extension opt-in `1.1`; contracts/adapters release `0.2.0`.
- Consumer cũ chỉ dùng envelope/context 1.0. URL có scenarioVersion=1.1 mới bật handshake assistant.scenario.ready và message dữ liệu/state/voice/navigation 1.1.
- Không thay hình dạng ContextSnapshot; recipient nằm trong AssistantData riêng.
- Navigation 1.1 gồm routeId/screenId/contextKey/confirmed; Host trả completed/rejected cùng requestId.
- JSON schemas mới: assistant-data, supported-feature và scenario-request; semantics phiên/freshness/xưng hô được validators/tests kiểm tra thêm.
- CI dùng chung scenario-data.json cho TS/Python, gồm timezone Z và offset; không copy/sửa schema trong Host.
- Patch sửa lỗi tương thích, minor thêm capability opt-in, major cho breaking changes.
- Release theo thứ tự contracts → adapters → Assistant → consumer; pin artifacts/checksums và rollback cùng bộ tương thích.

Chi tiết: [cấu hình](mia-configuration.md), [compatibility](compatibility.md).
