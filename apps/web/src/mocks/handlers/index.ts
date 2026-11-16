import { coreHandlers } from "./core";
import { closeHandlers } from "./close";
import { fluxHandlers } from "./flux";
import { v1Handlers } from "./v1";

export const handlers = [...coreHandlers, ...closeHandlers, ...fluxHandlers, ...v1Handlers];
