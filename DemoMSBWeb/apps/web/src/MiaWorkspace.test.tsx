import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { vi } from "vitest";
import { MiaWorkspace, type MenuChoice, type WorkspaceData } from "./MiaWorkspace";

const data: WorkspaceData = { recipient: { address: "anh/chị" }, todoList: [], offeringIds: [], statistics: { total: 0, byType: { "overdue-loan": 0, "document-debt": 0, "password-change": 0 } } };
const noop = () => {};
const primary: MenuChoice[] = [{ id: "todos", label: "Việc cần làm", actionId: "todos" }, { id: "offering", label: "Đề xuất sản phẩm", actionId: "offering:business-credit" }];

describe("MIA scenario menu", () => {
  it("hides configured groups while the error screen is prioritized", () => {
    const html = renderToStaticMarkup(<MiaWorkspace group="home" setGroup={noop} data={data} menu={primary} screenError={{ errorCode: "11000", message: "Thiếu thông tin" }} ready onAction={noop} error={false} retry={noop} onSelectTodo={noop} onListen={noop}/>);
    expect(html).not.toContain("mia-function-groups");
    expect(html).toContain("MIA thấy có Mã lỗi: 11000.");
  });
  it("returns to error help from the final Home group", async () => {
    const onAction = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    try {
      await act(async () => root.render(<MiaWorkspace group="home" setGroup={noop} data={data} menu={[...primary, { id: "error", label: "Hỗ trợ xử lý lỗi", actionId: "advisory:explain" }]} ready onAction={onAction} error={false} retry={noop} onSelectTodo={noop} onListen={noop}/>));
      await act(async () => (container.querySelector(".mia-function-groups button:last-child") as HTMLElement).click());
      expect(onAction).toHaveBeenCalledWith("advisory:explain");
    } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
  });
  it("keeps the conversation anchored and opens only one task group", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () => { root.render(<MiaWorkspace group="todos" setGroup={noop} data={data} menu={primary} ready onAction={noop} error={false} retry={noop} onSelectTodo={noop} onListen={noop} conversation={<div data-testid="conversation"/>}/>); });
      expect(container.querySelectorAll("details[open]")).toHaveLength(1);
      const summaries = container.querySelectorAll("summary");
      await act(async () => { (summaries[1] as HTMLElement).click(); });
      expect(container.querySelectorAll("details[open]")).toHaveLength(1);
      expect(container.querySelector("details[open] summary")?.textContent).toContain("Nợ chứng từ");
      expect(container.querySelector('[data-testid="conversation"]')?.nextElementSibling?.className).toBe("mia-home-support");
    } finally {
      await act(async () => { root.unmount(); });
      vi.unstubAllGlobals();
    }
  });
  for (const menu of [[], primary.slice(0, 1), primary.slice(1), primary]) {
    it(`shows only scenario choices: ${menu.map(item => item.id).join(",") || "none"}`, () => {
      const html = renderToStaticMarkup(<MiaWorkspace group="home" setGroup={noop} data={data} menu={menu} ready onAction={noop} error={false} retry={noop} onSelectTodo={noop} onListen={noop}/>);
      const document = new DOMParser().parseFromString(html, "text/html");
      expect([...document.querySelectorAll(".mia-function-groups strong")].map(item => item.textContent)).toEqual(menu.map(item => item.label));
      expect([...document.querySelectorAll(".mia-home-support button")].map(item => item.textContent)).toEqual(["Hướng dẫn sử dụng", "Yêu cầu khác"]);
      expect(html).not.toContain("Thực hiện giao dịch");
    });
  }
});
