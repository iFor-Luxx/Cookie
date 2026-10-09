// server/api — Worker delgado: parse+validate+auth -> use case -> repo (H4).
export default {
  async fetch(): Promise<Response> {
    return Response.json({ ok: true, service: "cookie-api", v: 1 });
  },
};
