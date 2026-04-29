import { AdapterRegistry } from "./lib/adapter-registry.js";
import { TaskStore } from "./lib/task-store.js";
import { Poller } from "./lib/poller.js";
import { volcengineImageAdapter } from "./adapters/volcengine.js";
import { openaiImageAdapter } from "./adapters/openai.js";
import {
  ensureWritableGeneratedDir,
  removeGeneratedFiles,
  resolveGeneratedDir,
} from "./lib/generated-dir.js";

export default class ImageGenPlugin {
  async onload() {
    const { bus, log } = this.ctx;

    const registry = new AdapterRegistry();
    const store = new TaskStore(this.ctx.dataDir);
    const poller = new Poller({
      store,
      registry,
      bus,
      generatedDir: () => resolveGeneratedDir(this.ctx),
      log,
    });

    registry.register(volcengineImageAdapter);
    registry.register({ ...volcengineImageAdapter, id: "volcengine-coding" });
    registry.register(openaiImageAdapter);

    const getGeneratedDir = () => resolveGeneratedDir(this.ctx);
    const getWritableGeneratedDir = (options) => ensureWritableGeneratedDir(this.ctx, options);
    this.ctx._mediaGen = {
      registry,
      store,
      poller,
      getGeneratedDir,
      getWritableGeneratedDir,
    };

    this.register(bus.handle("media-gen:register-adapter", ({ adapter }) => {
      registry.register(adapter);
      log.info(`adapter registered: ${adapter.id}`);
      return { ok: true };
    }));

    this.register(bus.handle("media-gen:unregister-adapter", ({ adapterId }) => {
      registry.unregister(adapterId);
      log.info(`adapter unregistered: ${adapterId}`);
      return { ok: true };
    }));

    this.register(bus.subscribe((event) => {
      if (event.type === "media-gen:adapter-removed" && event.adapterId) {
        registry.unregister(event.adapterId);
        log.info(`adapter removed (event): ${event.adapterId}`);
      }
    }));

    this.register(bus.handle("media-gen:list-adapters", () => {
      return { adapters: registry.list().map((adapter) => ({ id: adapter.id, name: adapter.name, types: adapter.types })) };
    }));

    this.register(bus.handle("media-gen:get-tasks", ({ adapterId, batchId, status } = {}) => {
      let tasks = store.listAll();
      if (adapterId) tasks = tasks.filter((task) => task.adapterId === adapterId);
      if (batchId) tasks = tasks.filter((task) => task.batchId === batchId);
      if (status) tasks = tasks.filter((task) => task.status === status);
      return { tasks };
    }));

    this.register(bus.handle("media-gen:get-task", ({ taskId }) => {
      return { task: store.get(taskId) };
    }));

    this.register(bus.handle("media-gen:update-task", ({ taskId, fields }) => {
      const allowed = {};
      if (typeof fields?.favorited === "boolean") allowed.favorited = fields.favorited;
      store.update(taskId, allowed);
      return { ok: true };
    }));

    this.register(bus.handle("media-gen:remove-task", ({ taskId }) => {
      const task = store.get(taskId);
      if (task) {
        removeGeneratedFiles(this.ctx, task.files || []);
        store.remove(taskId);
      }
      return { ok: true };
    }));

    this.register(bus.handle("media-gen:remove-unfavorited", () => {
      const removed = store.removeUnfavorited();
      for (const task of removed) {
        removeGeneratedFiles(this.ctx, task.files || []);
      }
      return { ok: true, removed: removed.length };
    }));

    poller.start();

    bus.request("task:register-handler", {
      type: "media-generation",
      abort: (taskId) => { poller.cancel(taskId); },
    }).catch(() => {});

    this.register(() => {
      poller.stop();
      store.destroy();
      bus.request("task:unregister-handler", { type: "media-generation" }).catch(() => {});
      log.info("image-gen plugin unloaded");
    });

    log.info("image-gen plugin loaded");
  }
}
