"use strict";

/**
 * shared/artifact-core/index.cjs
 *
 * Aggregator for the SWIFT artifact-core library. Namespaced (not
 * flattened) so future consumers (C3 slice B build wiring, C4 update
 * manager) can require exactly the surface they need without name
 * collisions between modules.
 */

module.exports = {
  ustar: require("./ustar.cjs"),
  manifest: require("./manifest.cjs"),
  pointerStore: require("./pointer-store.cjs"),
  activation: require("./activation.cjs"),
};
