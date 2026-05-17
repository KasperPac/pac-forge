import { buildApp } from "./app.js";

const app = buildApp();
const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || "0.0.0.0";

app.listen({ port, host }).catch((e) => {
  app.log.error(e);
  process.exit(1);
});
