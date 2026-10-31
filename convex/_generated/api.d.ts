/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as competitions from "../competitions.js";
import type * as cots from "../cots.js";
import type * as dashboard from "../dashboard.js";
import type * as github from "../github.js";
import type * as http from "../http.js";
import type * as intake from "../intake.js";
import type * as inventory from "../inventory.js";
import type * as lib_assembly from "../lib/assembly.js";
import type * as lib_assemblyTree from "../lib/assemblyTree.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_budget from "../lib/budget.js";
import type * as lib_github from "../lib/github.js";
import type * as lib_githubRest from "../lib/githubRest.js";
import type * as lib_githubWebhookAuth from "../lib/githubWebhookAuth.js";
import type * as lib_intake from "../lib/intake.js";
import type * as lib_numbering from "../lib/numbering.js";
import type * as lib_onshapeAssembly from "../lib/onshapeAssembly.js";
import type * as lib_onshapeAuth from "../lib/onshapeAuth.js";
import type * as lib_onshapeLinks from "../lib/onshapeLinks.js";
import type * as lib_onshapePanelHtml from "../lib/onshapePanelHtml.js";
import type * as lib_onshapeRelease from "../lib/onshapeRelease.js";
import type * as lib_onshapeSync from "../lib/onshapeSync.js";
import type * as lib_season from "../lib/season.js";
import type * as lib_stages from "../lib/stages.js";
import type * as lib_tokenCrypto from "../lib/tokenCrypto.js";
import type * as onshape from "../onshape.js";
import type * as onshapeOAuth from "../onshapeOAuth.js";
import type * as onshapeWebhook from "../onshapeWebhook.js";
import type * as parts from "../parts.js";
import type * as seasons from "../seasons.js";
import type * as seed from "../seed.js";
import type * as settings from "../settings.js";
import type * as shop from "../shop.js";
import type * as subAssemblies from "../subAssemblies.js";
import type * as subsystems from "../subsystems.js";
import type * as todos from "../todos.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  competitions: typeof competitions;
  cots: typeof cots;
  dashboard: typeof dashboard;
  github: typeof github;
  http: typeof http;
  intake: typeof intake;
  inventory: typeof inventory;
  "lib/assembly": typeof lib_assembly;
  "lib/assemblyTree": typeof lib_assemblyTree;
  "lib/auth": typeof lib_auth;
  "lib/budget": typeof lib_budget;
  "lib/github": typeof lib_github;
  "lib/githubRest": typeof lib_githubRest;
  "lib/githubWebhookAuth": typeof lib_githubWebhookAuth;
  "lib/intake": typeof lib_intake;
  "lib/numbering": typeof lib_numbering;
  "lib/onshapeAssembly": typeof lib_onshapeAssembly;
  "lib/onshapeAuth": typeof lib_onshapeAuth;
  "lib/onshapeLinks": typeof lib_onshapeLinks;
  "lib/onshapePanelHtml": typeof lib_onshapePanelHtml;
  "lib/onshapeRelease": typeof lib_onshapeRelease;
  "lib/onshapeSync": typeof lib_onshapeSync;
  "lib/season": typeof lib_season;
  "lib/stages": typeof lib_stages;
  "lib/tokenCrypto": typeof lib_tokenCrypto;
  onshape: typeof onshape;
  onshapeOAuth: typeof onshapeOAuth;
  onshapeWebhook: typeof onshapeWebhook;
  parts: typeof parts;
  seasons: typeof seasons;
  seed: typeof seed;
  settings: typeof settings;
  shop: typeof shop;
  subAssemblies: typeof subAssemblies;
  subsystems: typeof subsystems;
  todos: typeof todos;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
