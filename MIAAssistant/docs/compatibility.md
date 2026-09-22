# Compatibility matrix

| Contracts | Web adapter | RN adapter | Context wire | Scenario wire | Consumer |
|---|---|---|---|---|---|
| 0.1.x | 0.1.x | 0.1.x | 1.0 | Không hỗ trợ | Chat/tư vấn lỗi cũ |
| 0.2.0 | 0.2.0 | 0.2.0 | 1.0 | 1.1, opt-in | DemoMSBWeb/DemoMSBApp có bootstrap/data/voice/navigation mới |

Assistant hiện tại hỗ trợ chat 1.0 và capability scenario 1.1 được công bố tại /readyz. Consumer 1.0 không nhận payload scenario. Host Web kiểm tra origin/version/readiness; Mobile pin packages và Assistant URL, có fallback khi tải lỗi.

Tắt extension để dùng chat 1.0: MIA_SCENARIOS_ENABLED=false trên Web; EXPO_PUBLIC_MIA_SCENARIOS_ENABLED=false khi build/bundle Mobile. Khi rollback consumer về 0.1.x, pin lại cả contracts/adapters và Assistant tương thích; giữ tarball cũ.
