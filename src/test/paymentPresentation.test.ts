import { describe, expect, it } from "vitest";
import {
  isServerCancelledPayment,
  isServerConfirmedPayment,
  isServerReleasePending,
} from "@/lib/paymentPresentation";

describe("payment presentation", () => {
  it("never treats a client redirect or pending state as payment proof", () => {
    expect(isServerConfirmedPayment("loading")).toBe(false);
    expect(isServerConfirmedPayment("checkout_created")).toBe(false);
    expect(isServerConfirmedPayment("payment_processing")).toBe(false);
    expect(isServerConfirmedPayment("success")).toBe(false);
  });

  it("only treats a physically-confirmed lifecycle state as delivered", () => {
    expect(isServerConfirmedPayment("payment_succeeded")).toBe(false);
    expect(isServerConfirmedPayment("ejecting")).toBe(false);
    expect(isServerConfirmedPayment("ejected")).toBe(true);
    expect(isServerConfirmedPayment("completed")).toBe(true);
  });

  it("keeps verified payments in a non-final release state until hardware is confirmed", () => {
    expect(isServerReleasePending("payment_succeeded")).toBe(true);
    expect(isServerReleasePending("ejecting")).toBe(true);
    expect(isServerReleasePending("ejected")).toBe(false);
  });

  it("recognizes terminal payment failures from the server", () => {
    expect(isServerCancelledPayment("payment_expired")).toBe(true);
    expect(isServerCancelledPayment("payment_failed")).toBe(true);
    expect(isServerCancelledPayment("payment_succeeded")).toBe(false);
  });
});
