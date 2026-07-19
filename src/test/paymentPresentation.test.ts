import { describe, expect, it } from "vitest";
import { isServerCancelledPayment, isServerConfirmedPayment } from "@/lib/paymentPresentation";

describe("payment presentation", () => {
  it("never treats a client redirect or pending state as payment proof", () => {
    expect(isServerConfirmedPayment("loading")).toBe(false);
    expect(isServerConfirmedPayment("checkout_created")).toBe(false);
    expect(isServerConfirmedPayment("payment_processing")).toBe(false);
    expect(isServerConfirmedPayment("success")).toBe(false);
  });

  it("accepts only server-confirmed lifecycle states", () => {
    expect(isServerConfirmedPayment("payment_succeeded")).toBe(true);
    expect(isServerConfirmedPayment("ejected")).toBe(true);
    expect(isServerConfirmedPayment("completed")).toBe(true);
  });

  it("recognizes terminal payment failures from the server", () => {
    expect(isServerCancelledPayment("payment_expired")).toBe(true);
    expect(isServerCancelledPayment("payment_failed")).toBe(true);
    expect(isServerCancelledPayment("payment_succeeded")).toBe(false);
  });
});

