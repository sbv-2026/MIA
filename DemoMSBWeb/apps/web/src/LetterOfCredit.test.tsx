import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LetterOfCreditForm, type LcDraft } from "./LetterOfCredit";

const mounted: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (mounted.length) await mounted.pop()?.();
  vi.unstubAllGlobals();
});

function field(container: HTMLElement, label: string, index = 0) {
  return [...container.querySelectorAll<HTMLLabelElement>("label.lc-field")]
    .filter(item => item.querySelector(":scope > span")?.textContent === label)[index];
}

describe("assisted L/C form", () => {
  it("applies extracted values when an already-open form receives the MIA draft", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    const root = createRoot(container);
    mounted.push(async () => { await act(async () => root.unmount()); });
    const navigate = vi.fn();

    await act(async () => root.render(<LetterOfCreditForm mode="issue" navigate={navigate} initialData={null}/>));
    expect(container.querySelector(".lc-assistant-banner")).toBeNull();

    const draft: LcDraft = {
      fields: {
        lcType: "LC thường",
        issueMode: "LC chính thức",
        currency: "USD",
        amount: "50,000",
        beneficiaryName: "GLOBAL PARTS LTD",
        swift: "BOFAUS3N",
        requiredDocuments: "Hóa đơn thương mại có chữ ký | Giấy chứng nhận xuất xứ",
      },
      missingFields: ["expiryDate"],
    };
    await act(async () => root.render(<LetterOfCreditForm mode="issue" navigate={navigate} initialData={draft}/>));

    expect((field(container, "32B: Số tiền (Currency, Amount) *")?.querySelector("input") as HTMLInputElement).value).toBe("50,000");
    expect((field(container, "Tên đầy đủ (Full name) *", 1)?.querySelector("input") as HTMLInputElement).value).toBe("GLOBAL PARTS LTD");
    expect((field(container, "Mã SWIFT *")?.querySelector("input") as HTMLInputElement).value).toBe("BOFAUS3N");
    expect([...container.querySelectorAll<HTMLInputElement>(".lc-document-row input[type=checkbox]")].filter(input => input.checked)).toHaveLength(2);
    expect(field(container, "31D: Ngày hết hạn (Expiry Date) *")?.classList.contains("lc-field-missing")).toBe(true);
    expect(container.querySelector(".lc-assistant-banner")?.textContent).toContain("tự động điền dữ liệu từ PO");
  });
});
