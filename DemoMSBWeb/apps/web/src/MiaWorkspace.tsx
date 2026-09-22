import { useState, type ReactNode } from "react";
import { ScrollArea } from "./ScrollArea";

export type MenuChoice = { id: string; label: string; actionId: string };
type TodoType = "overdue-loan" | "document-debt" | "password-change";
export type Todo = { todolistID: string; todotype: TodoType; dueDate: string; loanAccount?: string; business?: string; amount?: number };
export type WorkspaceData = { recipient: { address: string; pronoun?: string }; todoList: Todo[]; offeringIds: string[]; statistics: { total: number; byType: Record<TodoType, number> } };
type Group = "home" | "todos" | "transactions" | "offers";

const types: Array<{ type: TodoType; label: string; icon: string }> = [
  { type: "overdue-loan", label: "Khoản vay quá hạn", icon: "↗" },
  { type: "document-debt", label: "Nợ chứng từ", icon: "▤" },
  { type: "password-change", label: "Thay đổi mật khẩu", icon: "♧" },
];
const date = (value: string) => value.split("-").reverse().join("/");

export function MiaWorkspace({ group, setGroup, data, menu, ready, onAction, error, retry, onSelectTodo, onListen, conversation, muted, onToggleMute, screenError, supportAvailable = false }: { group: Group; setGroup: (group: Group) => void; data: WorkspaceData | null; menu: MenuChoice[]; ready: boolean; onAction: (actionId: string) => void; error: boolean; retry: () => void; onSelectTodo: (todo: Todo) => void; onListen: () => void; conversation?: ReactNode; muted?: boolean; onToggleMute?: () => void; screenError?: { errorCode: string; message: string } | null; supportAvailable?: boolean }) {
  const [expanded, setExpanded] = useState<TodoType | null>("overdue-loan");
  const supportAction = supportAvailable || menu.some(item => item.actionId === "advisory:handoff");
  const openMenu = (choice: MenuChoice) => {
    if (choice.id === "error") onAction(choice.actionId);
    else if (choice.id === "todos") setGroup("todos");
    else if (choice.id === "transactions") setGroup("transactions");
    else { setGroup("offers"); onAction(choice.actionId); }
  };
  return <div className={`mia-glass-workspace mia-group-${group}`}>
    <section className="mia-introduction"><div className="mia-orb" aria-hidden="true">M</div><div><span className="mia-eyebrow">MIA</span><h2>Xin chào {data?.recipient.address ?? "anh/chị"}!</h2><p>MIA sẵn sàng hỗ trợ {data?.recipient.pronoun ?? "anh/chị"}.</p></div></section>
    {!screenError && group !== "home" && <h3 className="mia-section-title">{group === "todos" ? "Việc cần làm" : group === "offers" ? "Đề xuất sản phẩm" : "Thực hiện giao dịch"}</h3>}
    {error ? <div role="alert">Không thể tải dữ liệu. <button onClick={retry}>Thử lại</button></div> : !data ? <p role="status">Đang tải thông tin…</p> : <>
      {!screenError && group === "home" && <div className="mia-function-groups">{menu.filter(choice => !["guide", "other"].includes(choice.id)).map(choice => <button key={choice.id} disabled={!ready} onClick={() => openMenu(choice)}><span aria-hidden="true">{choice.id === "todos" ? "☷" : choice.id === "offering" ? "♡" : choice.id === "transactions" ? "↗" : "!"}</span><strong>{choice.label}</strong>{choice.id === "todos" && <small>{data.statistics.total} việc cần làm</small>}</button>)}</div>}
      {!screenError && group === "todos" && <ScrollArea resetKey={data}><section className="mia-todo-region"><div className="mia-todo-statistics" aria-label="Thống kê việc cần làm"><b>{data.statistics.total}<small>Tổng việc</small></b>{types.map(item => <b key={item.type}>{data.statistics.byType[item.type]}<small>{item.label}</small></b>)}</div>{data.todoList.length === 0 && <p>Bạn không có việc cần làm. MIA sẽ nhắc khi có công việc mới.</p>}{types.map(item => {
        const todos = data.todoList.filter(todo => todo.todotype === item.type);
        return <details className="mia-todo-group" key={item.type} open={expanded === item.type}><summary onClick={event => { event.preventDefault(); setExpanded(expanded === item.type ? null : item.type); }}>{item.label}<span>{todos.length}</span></summary>{todos.length === 0 ? <p className="mia-empty">Không có việc cần làm trong nhóm này.</p> : todos.map(todo => <button type="button" className="mia-todo-card mia-todo-action" key={todo.todolistID} onClick={() => onSelectTodo(todo)}><span className="mia-todo-icon" aria-hidden="true">{item.icon}</span><div><h3>{todo.todotype === "overdue-loan" ? `Tài khoản vay ${todo.loanAccount}` : todo.todotype === "document-debt" ? todo.business : "Đến hạn đổi mật khẩu"}</h3><p>{todo.todotype === "overdue-loan" ? `Khoản vay quá hạn từ ${date(todo.dueDate)}${todo.amount ? ` · ${todo.amount.toLocaleString("vi-VN")} VND` : ""}.` : todo.todotype === "document-debt" ? `Vui lòng bổ sung chứng từ trước ${date(todo.dueDate)}.` : `Vui lòng đổi mật khẩu trước ${date(todo.dueDate)}.`}</p><small>Mã việc: {todo.todolistID}</small></div><span aria-hidden="true">›</span></button>)}</details>;
      })}</section></ScrollArea>}
      {!screenError && group === "offers" && <section className="mia-todo-region">{data.offeringIds.length ? data.offeringIds.map(id => <article className="mia-todo-card" key={id}><span className="mia-todo-icon">♡</span><div><h3>{id === "business-credit" ? "Chứng chỉ tiền gửi" : id}</h3><p>Sinh lời mỗi ngày, thời gian nắm giữ linh hoạt và giao dịch trực tuyến an toàn.</p></div></article>) : <p>Hiện chưa có ưu đãi dành cho bạn.</p>}</section>}
      {!screenError && group === "transactions" && <section className="mia-todo-region mia-transaction-region">
        <button type="button" className="mia-todo-card mia-todo-action" onClick={() => onAction("direct:navigate:domestic-disbursement-create")}><span className="mia-todo-icon">₫</span><div><h3>Giải ngân thanh toán trong nước</h3><p>Tạo đề nghị giải ngân và chỉ dẫn thanh toán.</p></div><span>›</span></button>
        <button type="button" className="mia-todo-card mia-todo-action" onClick={() => onAction("transaction:lc")}><span className="mia-todo-icon">LC</span><div><h3>Phát hành LC</h3><p>MIA hỗ trợ chuẩn bị hồ sơ và tự động điền thông tin L/C.</p></div><span>›</span></button>
        <button type="button" className="mia-todo-card mia-todo-action" onClick={() => onAction("direct:navigate:single-transfer-create")}><span className="mia-todo-icon">⇄</span><div><h3>Chuyển tiền trong nước</h3><p>Tạo giao dịch chuyển tiền nội địa.</p></div><span>›</span></button>
      </section>}
    </>}
    {screenError && <section className="mia-screen-error" role="alert"><h3>MIA thấy có Mã lỗi: {screenError.errorCode}.</h3><p>{screenError.message}</p></section>}
    {conversation}
    <nav className="mia-home-support" aria-label="Hỗ trợ thêm"><button disabled={!ready} onClick={() => onAction("guide")}>Hướng dẫn sử dụng</button><button disabled={!ready} onClick={() => onAction(supportAction ? "advisory:handoff" : "other")}>{supportAction ? "Gửi lỗi tới MSB" : "Yêu cầu khác"}</button></nav>
    <div className="mia-voice-actions"><button className="mia-start-voice" disabled={!ready} onClick={onListen}>♩ Chạm vào MIA để nói</button><button className="mia-start-voice" aria-pressed={!!muted} onClick={onToggleMute}>{muted ? "Bật tiếng" : "Tắt tiếng"}</button></div>
  </div>;
}
