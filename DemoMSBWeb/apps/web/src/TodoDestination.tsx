import { useEffect, useState, type FormEvent } from "react";
import type { Todo } from "./MiaWorkspace";

export function TodoDestination({ sessionId, todoId, kind }: { sessionId: string; todoId: string | null; kind: "document-debt" | "password-change" }) {
  const [todos, setTodos] = useState<Todo[] | null>(null);
  const [error, setError] = useState(false);
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/host/assistant-data/${encodeURIComponent(sessionId)}?details=true`, { signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(); return response.json() as Promise<{todoList: Todo[]}>; })
      .then(data => setTodos(data.todoList.filter(todo => todo.todotype === kind))).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [sessionId, kind]);
  const submit = (event: FormEvent) => { event.preventDefault(); if (password !== repeat) { setNotice("Mật khẩu xác nhận chưa khớp."); return; } setPassword(""); setRepeat(""); setNotice("Đã hoàn thành thao tác đổi mật khẩu mô phỏng. Mật khẩu đăng nhập thực tế không thay đổi."); };
  return <div className="page"><h1>{kind === "document-debt" ? "Quản lý chứng từ" : "Thay đổi mật khẩu"}</h1><section className="card"><h2>{kind === "document-debt" ? "Nợ chứng từ theo nghiệp vụ" : "Bảo vệ giao dịch của bạn"}</h2>{error ? <p role="alert">Không thể tải công việc.</p> : todos === null ? <p role="status">Đang tải công việc…</p> : <div className="todo-destination-list">{todos.map(todo => <article key={todo.todolistID} className={todoId === todo.todolistID ? "selected" : ""}><h3>{todo.business ?? "Đến hạn đổi mật khẩu"}</h3><p>Hạn xử lý: {todo.dueDate.split("-").reverse().join("/")}</p><small>Mã việc: {todo.todolistID}</small>{kind === "document-debt" && <label className="field"><span>Bổ sung chứng từ demo</span><input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={event => setNotice(event.target.files?.[0] ? `Đã chọn ${event.target.files[0].name} cho nghiệp vụ ${todo.business}. Tệp chưa được gửi đến ngân hàng.` : "")}/></label>}</article>)}</div>}{kind === "password-change" && <form className="demo-password-form" onSubmit={submit}><label>Mật khẩu mới<input autoComplete="new-password" type="password" minLength={8} required value={password} onChange={event => setPassword(event.target.value)}/></label><label>Xác nhận mật khẩu mới<input autoComplete="new-password" type="password" required value={repeat} onChange={event => setRepeat(event.target.value)}/></label><button className="primary-button">Đổi mật khẩu demo</button></form>}{notice && <p role="status">{notice}</p>}</section></div>;
}
