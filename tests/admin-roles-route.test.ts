import { beforeEach, afterEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const requireAdmin = vi.fn(async () => undefined);
vi.mock("@/lib/admin/server", () => ({ requireAdmin }));
const result = { data: { id: "engineer" }, error: null as null | { code: string; message: string } };
const chain = {
  select: vi.fn(() => chain), order: vi.fn(() => chain), eq: vi.fn(() => chain),
  insert: vi.fn(() => chain), update: vi.fn(() => chain), delete: vi.fn(() => chain),
  single: vi.fn(async () => result), maybeSingle: vi.fn(async () => result),
};
const createAdminClient = vi.fn(() => ({ from: vi.fn(() => chain) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
const { POST } = await import("@/app/api/admin/roles/route");
const { PATCH, DELETE } = await import("@/app/api/admin/roles/[id]/route");
const context = { params: Promise.resolve({ id: "engineer" }) };
const role = { id: "engineer", title: "Engineer", pay_rate: "$10/hour", job_type: "Contract", responsibilities: [], requirements: [] };
function request(method: string, body?: unknown, origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/admin/roles/engineer", {
    method, headers: { origin, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  result.error = null;
  requireAdmin.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

for (const method of ["POST", "PATCH", "DELETE"]) {
  it(`${method} rejects cross-site writes before authentication or database access`, async () => {
    const req = request(method, method === "DELETE" ? undefined : role, "https://evil.example");
    const response = method === "POST" ? await POST(req) : method === "PATCH" ? await PATCH(req, context) : await DELETE(req, context);
    expect(response.status).toBe(403);
    expect(requireAdmin).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });
  it(`${method} requires admin authorization before database access`, async () => {
    requireAdmin.mockRejectedValueOnce(new Error("denied"));
    const req = request(method, method === "DELETE" ? undefined : role);
    await expect(method === "POST" ? POST(req) : method === "PATCH" ? PATCH(req, context) : DELETE(req, context)).rejects.toThrow("denied");
    expect(createAdminClient).not.toHaveBeenCalled();
  });
}
for (const field of ["responsibilities", "requirements"]) {
  for (const malformed of [[null], [{ title: "Heading", text: { secret: "not text" } }]]) {
    it(`rejects malformed ${field} on create and update: ${JSON.stringify(malformed)}`, async () => {
      expect((await POST(request("POST", { ...role, [field]: malformed }))).status).toBe(400);
      expect((await PATCH(request("PATCH", { [field]: malformed }), context)).status).toBe(400);
      expect(createAdminClient).not.toHaveBeenCalled();
    });
  }
}
it("creates a role and preserves structured bullets", async () => {
  const body = { ...role, responsibilities: [{ title: "Build", text: "Features" }] };
  expect((await POST(request("POST", body))).status).toBe(201);
  expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining(body));
});
it("updates only supplied fields and scopes mutation to the requested ID", async () => {
  expect((await PATCH(request("PATCH", { is_active: false }), context)).status).toBe(200);
  expect(chain.update).toHaveBeenCalledWith({ is_active: false });
  expect(chain.eq).toHaveBeenCalledWith("id", "engineer");
});
it("does not disclose raw database errors in logs or responses", async () => {
  result.error = { code: "23503", message: "private database content" };
  const response = await DELETE(request("DELETE"), context);
  expect(response.status).toBe(500);
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("private database content");
  expect(await response.text()).not.toContain("private database content");
});
