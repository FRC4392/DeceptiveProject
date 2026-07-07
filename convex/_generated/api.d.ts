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
import type * as authActions from "../authActions.js";
import type * as boards from "../boards.js";
import type * as competitions from "../competitions.js";
import type * as dashboard from "../dashboard.js";
import type * as github from "../github.js";
import type * as http from "../http.js";
import type * as inventory from "../inventory.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_github from "../lib/github.js";
import type * as lib_githubRest from "../lib/githubRest.js";
import type * as lib_githubWebhookAuth from "../lib/githubWebhookAuth.js";
import type * as lib_inferMethod from "../lib/inferMethod.js";
import type * as lib_onshapeAssembly from "../lib/onshapeAssembly.js";
import type * as lib_onshapeAuth from "../lib/onshapeAuth.js";
import type * as lib_onshapePanelHtml from "../lib/onshapePanelHtml.js";
import type * as lib_onshapeSync from "../lib/onshapeSync.js";
import type * as lib_taskSync from "../lib/taskSync.js";
import type * as lib_tokenCrypto from "../lib/tokenCrypto.js";
import type * as onshape from "../onshape.js";
import type * as onshapeOAuth from "../onshapeOAuth.js";
import type * as parts from "../parts.js";
import type * as projects from "../projects.js";
import type * as tasks from "../tasks.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  authActions: typeof authActions;
  boards: typeof boards;
  competitions: typeof competitions;
  dashboard: typeof dashboard;
  github: typeof github;
  http: typeof http;
  inventory: typeof inventory;
  "lib/auth": typeof lib_auth;
  "lib/github": typeof lib_github;
  "lib/githubRest": typeof lib_githubRest;
  "lib/githubWebhookAuth": typeof lib_githubWebhookAuth;
  "lib/inferMethod": typeof lib_inferMethod;
  "lib/onshapeAssembly": typeof lib_onshapeAssembly;
  "lib/onshapeAuth": typeof lib_onshapeAuth;
  "lib/onshapePanelHtml": typeof lib_onshapePanelHtml;
  "lib/onshapeSync": typeof lib_onshapeSync;
  "lib/taskSync": typeof lib_taskSync;
  "lib/tokenCrypto": typeof lib_tokenCrypto;
  onshape: typeof onshape;
  onshapeOAuth: typeof onshapeOAuth;
  parts: typeof parts;
  projects: typeof projects;
  tasks: typeof tasks;
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

export declare const components: {
  workOSAuthKit: import("@convex-dev/workos-authkit/_generated/component.js").ComponentApi<"workOSAuthKit">;
};
