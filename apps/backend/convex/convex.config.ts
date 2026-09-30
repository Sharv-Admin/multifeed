import hexclaveAuthComponent from "@hexclave/next/convex.config";
import r2 from "@convex-dev/r2/convex.config.js";
import stripe from "@convex-dev/stripe/convex.config.js";
import { defineApp, type ComponentDefinition } from "convex/server";

const app = defineApp();
app.use(hexclaveAuthComponent as unknown as ComponentDefinition);
app.use(r2);
app.use(stripe);

export default app;
