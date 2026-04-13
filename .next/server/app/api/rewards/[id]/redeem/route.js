"use strict";
/*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
(() => {
var exports = {};
exports.id = "app/api/rewards/[id]/redeem/route";
exports.ids = ["app/api/rewards/[id]/redeem/route"];
exports.modules = {

/***/ "@prisma/client":
/*!*********************************!*\
  !*** external "@prisma/client" ***!
  \*********************************/
/***/ ((module) => {

module.exports = require("@prisma/client");

/***/ }),

/***/ "../../client/components/action-async-storage.external":
/*!*******************************************************************************!*\
  !*** external "next/dist/client/components/action-async-storage.external.js" ***!
  \*******************************************************************************/
/***/ ((module) => {

module.exports = require("next/dist/client/components/action-async-storage.external.js");

/***/ }),

/***/ "../../client/components/request-async-storage.external":
/*!********************************************************************************!*\
  !*** external "next/dist/client/components/request-async-storage.external.js" ***!
  \********************************************************************************/
/***/ ((module) => {

module.exports = require("next/dist/client/components/request-async-storage.external.js");

/***/ }),

/***/ "../../client/components/static-generation-async-storage.external":
/*!******************************************************************************************!*\
  !*** external "next/dist/client/components/static-generation-async-storage.external.js" ***!
  \******************************************************************************************/
/***/ ((module) => {

module.exports = require("next/dist/client/components/static-generation-async-storage.external.js");

/***/ }),

/***/ "next/dist/compiled/next-server/app-page.runtime.dev.js":
/*!*************************************************************************!*\
  !*** external "next/dist/compiled/next-server/app-page.runtime.dev.js" ***!
  \*************************************************************************/
/***/ ((module) => {

module.exports = require("next/dist/compiled/next-server/app-page.runtime.dev.js");

/***/ }),

/***/ "next/dist/compiled/next-server/app-route.runtime.dev.js":
/*!**************************************************************************!*\
  !*** external "next/dist/compiled/next-server/app-route.runtime.dev.js" ***!
  \**************************************************************************/
/***/ ((module) => {

module.exports = require("next/dist/compiled/next-server/app-route.runtime.dev.js");

/***/ }),

/***/ "assert":
/*!*************************!*\
  !*** external "assert" ***!
  \*************************/
/***/ ((module) => {

module.exports = require("assert");

/***/ }),

/***/ "buffer":
/*!*************************!*\
  !*** external "buffer" ***!
  \*************************/
/***/ ((module) => {

module.exports = require("buffer");

/***/ }),

/***/ "crypto":
/*!*************************!*\
  !*** external "crypto" ***!
  \*************************/
/***/ ((module) => {

module.exports = require("crypto");

/***/ }),

/***/ "fs":
/*!*********************!*\
  !*** external "fs" ***!
  \*********************/
/***/ ((module) => {

module.exports = require("fs");

/***/ }),

/***/ "node:crypto":
/*!******************************!*\
  !*** external "node:crypto" ***!
  \******************************/
/***/ ((module) => {

module.exports = require("node:crypto");

/***/ }),

/***/ "stream":
/*!*************************!*\
  !*** external "stream" ***!
  \*************************/
/***/ ((module) => {

module.exports = require("stream");

/***/ }),

/***/ "util":
/*!***********************!*\
  !*** external "util" ***!
  \***********************/
/***/ ((module) => {

module.exports = require("util");

/***/ }),

/***/ "zlib":
/*!***********************!*\
  !*** external "zlib" ***!
  \***********************/
/***/ ((module) => {

module.exports = require("zlib");

/***/ }),

/***/ "(rsc)/./node_modules/next/dist/build/webpack/loaders/next-app-loader.js?name=app%2Fapi%2Frewards%2F%5Bid%5D%2Fredeem%2Froute&page=%2Fapi%2Frewards%2F%5Bid%5D%2Fredeem%2Froute&appPaths=&pagePath=private-next-app-dir%2Fapi%2Frewards%2F%5Bid%5D%2Fredeem%2Froute.ts&appDir=C%3A%5CUsers%5Ctzvai%5COneDrive%5CBSc%5Cyear_3%5Cworkshop%5Ccarma%5Csrc%5Capp&pageExtensions=tsx&pageExtensions=ts&pageExtensions=jsx&pageExtensions=js&rootDir=C%3A%5CUsers%5Ctzvai%5COneDrive%5CBSc%5Cyear_3%5Cworkshop%5Ccarma&isDev=true&tsconfigPath=tsconfig.json&basePath=&assetPrefix=&nextConfigOutput=standalone&preferredRegion=&middlewareConfig=e30%3D!":
/*!***************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************!*\
  !*** ./node_modules/next/dist/build/webpack/loaders/next-app-loader.js?name=app%2Fapi%2Frewards%2F%5Bid%5D%2Fredeem%2Froute&page=%2Fapi%2Frewards%2F%5Bid%5D%2Fredeem%2Froute&appPaths=&pagePath=private-next-app-dir%2Fapi%2Frewards%2F%5Bid%5D%2Fredeem%2Froute.ts&appDir=C%3A%5CUsers%5Ctzvai%5COneDrive%5CBSc%5Cyear_3%5Cworkshop%5Ccarma%5Csrc%5Capp&pageExtensions=tsx&pageExtensions=ts&pageExtensions=jsx&pageExtensions=js&rootDir=C%3A%5CUsers%5Ctzvai%5COneDrive%5CBSc%5Cyear_3%5Cworkshop%5Ccarma&isDev=true&tsconfigPath=tsconfig.json&basePath=&assetPrefix=&nextConfigOutput=standalone&preferredRegion=&middlewareConfig=e30%3D! ***!
  \***************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   originalPathname: () => (/* binding */ originalPathname),\n/* harmony export */   patchFetch: () => (/* binding */ patchFetch),\n/* harmony export */   requestAsyncStorage: () => (/* binding */ requestAsyncStorage),\n/* harmony export */   routeModule: () => (/* binding */ routeModule),\n/* harmony export */   serverHooks: () => (/* binding */ serverHooks),\n/* harmony export */   staticGenerationAsyncStorage: () => (/* binding */ staticGenerationAsyncStorage)\n/* harmony export */ });\n/* harmony import */ var next_dist_server_future_route_modules_app_route_module_compiled__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! next/dist/server/future/route-modules/app-route/module.compiled */ \"(rsc)/./node_modules/next/dist/server/future/route-modules/app-route/module.compiled.js\");\n/* harmony import */ var next_dist_server_future_route_modules_app_route_module_compiled__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(next_dist_server_future_route_modules_app_route_module_compiled__WEBPACK_IMPORTED_MODULE_0__);\n/* harmony import */ var next_dist_server_future_route_kind__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! next/dist/server/future/route-kind */ \"(rsc)/./node_modules/next/dist/server/future/route-kind.js\");\n/* harmony import */ var next_dist_server_lib_patch_fetch__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! next/dist/server/lib/patch-fetch */ \"(rsc)/./node_modules/next/dist/server/lib/patch-fetch.js\");\n/* harmony import */ var next_dist_server_lib_patch_fetch__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(next_dist_server_lib_patch_fetch__WEBPACK_IMPORTED_MODULE_2__);\n/* harmony import */ var C_Users_tzvai_OneDrive_BSc_year_3_workshop_carma_src_app_api_rewards_id_redeem_route_ts__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./src/app/api/rewards/[id]/redeem/route.ts */ \"(rsc)/./src/app/api/rewards/[id]/redeem/route.ts\");\n\n\n\n\n// We inject the nextConfigOutput here so that we can use them in the route\n// module.\nconst nextConfigOutput = \"standalone\"\nconst routeModule = new next_dist_server_future_route_modules_app_route_module_compiled__WEBPACK_IMPORTED_MODULE_0__.AppRouteRouteModule({\n    definition: {\n        kind: next_dist_server_future_route_kind__WEBPACK_IMPORTED_MODULE_1__.RouteKind.APP_ROUTE,\n        page: \"/api/rewards/[id]/redeem/route\",\n        pathname: \"/api/rewards/[id]/redeem\",\n        filename: \"route\",\n        bundlePath: \"app/api/rewards/[id]/redeem/route\"\n    },\n    resolvedPagePath: \"C:\\\\Users\\\\tzvai\\\\OneDrive\\\\BSc\\\\year_3\\\\workshop\\\\carma\\\\src\\\\app\\\\api\\\\rewards\\\\[id]\\\\redeem\\\\route.ts\",\n    nextConfigOutput,\n    userland: C_Users_tzvai_OneDrive_BSc_year_3_workshop_carma_src_app_api_rewards_id_redeem_route_ts__WEBPACK_IMPORTED_MODULE_3__\n});\n// Pull out the exports that we need to expose from the module. This should\n// be eliminated when we've moved the other routes to the new format. These\n// are used to hook into the route.\nconst { requestAsyncStorage, staticGenerationAsyncStorage, serverHooks } = routeModule;\nconst originalPathname = \"/api/rewards/[id]/redeem/route\";\nfunction patchFetch() {\n    return (0,next_dist_server_lib_patch_fetch__WEBPACK_IMPORTED_MODULE_2__.patchFetch)({\n        serverHooks,\n        staticGenerationAsyncStorage\n    });\n}\n\n\n//# sourceMappingURL=app-route.js.map//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKHJzYykvLi9ub2RlX21vZHVsZXMvbmV4dC9kaXN0L2J1aWxkL3dlYnBhY2svbG9hZGVycy9uZXh0LWFwcC1sb2FkZXIuanM/bmFtZT1hcHAlMkZhcGklMkZyZXdhcmRzJTJGJTVCaWQlNUQlMkZyZWRlZW0lMkZyb3V0ZSZwYWdlPSUyRmFwaSUyRnJld2FyZHMlMkYlNUJpZCU1RCUyRnJlZGVlbSUyRnJvdXRlJmFwcFBhdGhzPSZwYWdlUGF0aD1wcml2YXRlLW5leHQtYXBwLWRpciUyRmFwaSUyRnJld2FyZHMlMkYlNUJpZCU1RCUyRnJlZGVlbSUyRnJvdXRlLnRzJmFwcERpcj1DJTNBJTVDVXNlcnMlNUN0enZhaSU1Q09uZURyaXZlJTVDQlNjJTVDeWVhcl8zJTVDd29ya3Nob3AlNUNjYXJtYSU1Q3NyYyU1Q2FwcCZwYWdlRXh0ZW5zaW9ucz10c3gmcGFnZUV4dGVuc2lvbnM9dHMmcGFnZUV4dGVuc2lvbnM9anN4JnBhZ2VFeHRlbnNpb25zPWpzJnJvb3REaXI9QyUzQSU1Q1VzZXJzJTVDdHp2YWklNUNPbmVEcml2ZSU1Q0JTYyU1Q3llYXJfMyU1Q3dvcmtzaG9wJTVDY2FybWEmaXNEZXY9dHJ1ZSZ0c2NvbmZpZ1BhdGg9dHNjb25maWcuanNvbiZiYXNlUGF0aD0mYXNzZXRQcmVmaXg9Jm5leHRDb25maWdPdXRwdXQ9c3RhbmRhbG9uZSZwcmVmZXJyZWRSZWdpb249Jm1pZGRsZXdhcmVDb25maWc9ZTMwJTNEISIsIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7QUFBc0c7QUFDdkM7QUFDYztBQUN3RDtBQUNySTtBQUNBO0FBQ0E7QUFDQSx3QkFBd0IsZ0hBQW1CO0FBQzNDO0FBQ0EsY0FBYyx5RUFBUztBQUN2QjtBQUNBO0FBQ0E7QUFDQTtBQUNBLEtBQUs7QUFDTDtBQUNBO0FBQ0EsWUFBWTtBQUNaLENBQUM7QUFDRDtBQUNBO0FBQ0E7QUFDQSxRQUFRLGlFQUFpRTtBQUN6RTtBQUNBO0FBQ0EsV0FBVyw0RUFBVztBQUN0QjtBQUNBO0FBQ0EsS0FBSztBQUNMO0FBQ3VIOztBQUV2SCIsInNvdXJjZXMiOlsid2VicGFjazovL2Nhcm1hLz84MjQwIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEFwcFJvdXRlUm91dGVNb2R1bGUgfSBmcm9tIFwibmV4dC9kaXN0L3NlcnZlci9mdXR1cmUvcm91dGUtbW9kdWxlcy9hcHAtcm91dGUvbW9kdWxlLmNvbXBpbGVkXCI7XG5pbXBvcnQgeyBSb3V0ZUtpbmQgfSBmcm9tIFwibmV4dC9kaXN0L3NlcnZlci9mdXR1cmUvcm91dGUta2luZFwiO1xuaW1wb3J0IHsgcGF0Y2hGZXRjaCBhcyBfcGF0Y2hGZXRjaCB9IGZyb20gXCJuZXh0L2Rpc3Qvc2VydmVyL2xpYi9wYXRjaC1mZXRjaFwiO1xuaW1wb3J0ICogYXMgdXNlcmxhbmQgZnJvbSBcIkM6XFxcXFVzZXJzXFxcXHR6dmFpXFxcXE9uZURyaXZlXFxcXEJTY1xcXFx5ZWFyXzNcXFxcd29ya3Nob3BcXFxcY2FybWFcXFxcc3JjXFxcXGFwcFxcXFxhcGlcXFxccmV3YXJkc1xcXFxbaWRdXFxcXHJlZGVlbVxcXFxyb3V0ZS50c1wiO1xuLy8gV2UgaW5qZWN0IHRoZSBuZXh0Q29uZmlnT3V0cHV0IGhlcmUgc28gdGhhdCB3ZSBjYW4gdXNlIHRoZW0gaW4gdGhlIHJvdXRlXG4vLyBtb2R1bGUuXG5jb25zdCBuZXh0Q29uZmlnT3V0cHV0ID0gXCJzdGFuZGFsb25lXCJcbmNvbnN0IHJvdXRlTW9kdWxlID0gbmV3IEFwcFJvdXRlUm91dGVNb2R1bGUoe1xuICAgIGRlZmluaXRpb246IHtcbiAgICAgICAga2luZDogUm91dGVLaW5kLkFQUF9ST1VURSxcbiAgICAgICAgcGFnZTogXCIvYXBpL3Jld2FyZHMvW2lkXS9yZWRlZW0vcm91dGVcIixcbiAgICAgICAgcGF0aG5hbWU6IFwiL2FwaS9yZXdhcmRzL1tpZF0vcmVkZWVtXCIsXG4gICAgICAgIGZpbGVuYW1lOiBcInJvdXRlXCIsXG4gICAgICAgIGJ1bmRsZVBhdGg6IFwiYXBwL2FwaS9yZXdhcmRzL1tpZF0vcmVkZWVtL3JvdXRlXCJcbiAgICB9LFxuICAgIHJlc29sdmVkUGFnZVBhdGg6IFwiQzpcXFxcVXNlcnNcXFxcdHp2YWlcXFxcT25lRHJpdmVcXFxcQlNjXFxcXHllYXJfM1xcXFx3b3Jrc2hvcFxcXFxjYXJtYVxcXFxzcmNcXFxcYXBwXFxcXGFwaVxcXFxyZXdhcmRzXFxcXFtpZF1cXFxccmVkZWVtXFxcXHJvdXRlLnRzXCIsXG4gICAgbmV4dENvbmZpZ091dHB1dCxcbiAgICB1c2VybGFuZFxufSk7XG4vLyBQdWxsIG91dCB0aGUgZXhwb3J0cyB0aGF0IHdlIG5lZWQgdG8gZXhwb3NlIGZyb20gdGhlIG1vZHVsZS4gVGhpcyBzaG91bGRcbi8vIGJlIGVsaW1pbmF0ZWQgd2hlbiB3ZSd2ZSBtb3ZlZCB0aGUgb3RoZXIgcm91dGVzIHRvIHRoZSBuZXcgZm9ybWF0LiBUaGVzZVxuLy8gYXJlIHVzZWQgdG8gaG9vayBpbnRvIHRoZSByb3V0ZS5cbmNvbnN0IHsgcmVxdWVzdEFzeW5jU3RvcmFnZSwgc3RhdGljR2VuZXJhdGlvbkFzeW5jU3RvcmFnZSwgc2VydmVySG9va3MgfSA9IHJvdXRlTW9kdWxlO1xuY29uc3Qgb3JpZ2luYWxQYXRobmFtZSA9IFwiL2FwaS9yZXdhcmRzL1tpZF0vcmVkZWVtL3JvdXRlXCI7XG5mdW5jdGlvbiBwYXRjaEZldGNoKCkge1xuICAgIHJldHVybiBfcGF0Y2hGZXRjaCh7XG4gICAgICAgIHNlcnZlckhvb2tzLFxuICAgICAgICBzdGF0aWNHZW5lcmF0aW9uQXN5bmNTdG9yYWdlXG4gICAgfSk7XG59XG5leHBvcnQgeyByb3V0ZU1vZHVsZSwgcmVxdWVzdEFzeW5jU3RvcmFnZSwgc3RhdGljR2VuZXJhdGlvbkFzeW5jU3RvcmFnZSwgc2VydmVySG9va3MsIG9yaWdpbmFsUGF0aG5hbWUsIHBhdGNoRmV0Y2gsICB9O1xuXG4vLyMgc291cmNlTWFwcGluZ1VSTD1hcHAtcm91dGUuanMubWFwIl0sIm5hbWVzIjpbXSwic291cmNlUm9vdCI6IiJ9\n//# sourceURL=webpack-internal:///(rsc)/./node_modules/next/dist/build/webpack/loaders/next-app-loader.js?name=app%2Fapi%2Frewards%2F%5Bid%5D%2Fredeem%2Froute&page=%2Fapi%2Frewards%2F%5Bid%5D%2Fredeem%2Froute&appPaths=&pagePath=private-next-app-dir%2Fapi%2Frewards%2F%5Bid%5D%2Fredeem%2Froute.ts&appDir=C%3A%5CUsers%5Ctzvai%5COneDrive%5CBSc%5Cyear_3%5Cworkshop%5Ccarma%5Csrc%5Capp&pageExtensions=tsx&pageExtensions=ts&pageExtensions=jsx&pageExtensions=js&rootDir=C%3A%5CUsers%5Ctzvai%5COneDrive%5CBSc%5Cyear_3%5Cworkshop%5Ccarma&isDev=true&tsconfigPath=tsconfig.json&basePath=&assetPrefix=&nextConfigOutput=standalone&preferredRegion=&middlewareConfig=e30%3D!\n");

/***/ }),

/***/ "(rsc)/./src/app/api/rewards/[id]/redeem/route.ts":
/*!**************************************************!*\
  !*** ./src/app/api/rewards/[id]/redeem/route.ts ***!
  \**************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   POST: () => (/* binding */ POST)\n/* harmony export */ });\n/* harmony import */ var next_server__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! next/server */ \"(rsc)/./node_modules/next/dist/api/server.js\");\n/* harmony import */ var _lib_db__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! @/lib/db */ \"(rsc)/./src/lib/db.ts\");\n/* harmony import */ var _lib_auth__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! @/lib/auth */ \"(rsc)/./src/lib/auth.ts\");\n/* harmony import */ var nanoid__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! nanoid */ \"(rsc)/./node_modules/nanoid/index.js\");\n/* harmony import */ var qrcode__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! qrcode */ \"(rsc)/./node_modules/qrcode/lib/index.js\");\n\n\n\n\n\nasync function POST(_request, { params }) {\n    try {\n        const auth = (0,_lib_auth__WEBPACK_IMPORTED_MODULE_2__.getAuthUser)();\n        if (!auth) return next_server__WEBPACK_IMPORTED_MODULE_0__.NextResponse.json({\n            error: \"Unauthorized\"\n        }, {\n            status: 401\n        });\n        const reward = await _lib_db__WEBPACK_IMPORTED_MODULE_1__.prisma.reward.findUnique({\n            where: {\n                id: params.id\n            }\n        });\n        if (!reward || !reward.isActive) {\n            return next_server__WEBPACK_IMPORTED_MODULE_0__.NextResponse.json({\n                error: \"Reward not found or inactive\"\n            }, {\n                status: 404\n            });\n        }\n        if (reward.stock <= 0) {\n            return next_server__WEBPACK_IMPORTED_MODULE_0__.NextResponse.json({\n                error: \"Out of stock\"\n            }, {\n                status: 409\n            });\n        }\n        const user = await _lib_db__WEBPACK_IMPORTED_MODULE_1__.prisma.user.findUnique({\n            where: {\n                id: auth.userId\n            }\n        });\n        if (!user) return next_server__WEBPACK_IMPORTED_MODULE_0__.NextResponse.json({\n            error: \"User not found\"\n        }, {\n            status: 404\n        });\n        if (user.totalPoints < reward.pointsCost) {\n            return next_server__WEBPACK_IMPORTED_MODULE_0__.NextResponse.json({\n                error: \"Not enough points\"\n            }, {\n                status: 402\n            });\n        }\n        // Generate voucher\n        const code = (0,nanoid__WEBPACK_IMPORTED_MODULE_4__.nanoid)(12).toUpperCase();\n        const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) // 90 days\n        ;\n        const qrPayload = JSON.stringify({\n            code,\n            business: reward.business,\n            title: reward.title,\n            expiresAt: expiresAt.toISOString()\n        });\n        const qrData = await qrcode__WEBPACK_IMPORTED_MODULE_3__.toDataURL(qrPayload, {\n            width: 256,\n            margin: 1\n        });\n        const [voucher] = await _lib_db__WEBPACK_IMPORTED_MODULE_1__.prisma.$transaction([\n            _lib_db__WEBPACK_IMPORTED_MODULE_1__.prisma.voucher.create({\n                data: {\n                    userId: auth.userId,\n                    rewardId: reward.id,\n                    code,\n                    qrData,\n                    expiresAt\n                },\n                include: {\n                    reward: true\n                }\n            }),\n            _lib_db__WEBPACK_IMPORTED_MODULE_1__.prisma.user.update({\n                where: {\n                    id: auth.userId\n                },\n                data: {\n                    totalPoints: {\n                        decrement: reward.pointsCost\n                    }\n                }\n            }),\n            _lib_db__WEBPACK_IMPORTED_MODULE_1__.prisma.reward.update({\n                where: {\n                    id: reward.id\n                },\n                data: {\n                    stock: {\n                        decrement: 1\n                    }\n                }\n            })\n        ]);\n        // Notification\n        await _lib_db__WEBPACK_IMPORTED_MODULE_1__.prisma.notification.create({\n            data: {\n                userId: auth.userId,\n                type: \"reward\",\n                titleHe: \"פרס מומש!\",\n                titleEn: \"Reward Redeemed!\",\n                bodyHe: `מימשת את \"${reward.title}\" בהצלחה.`,\n                bodyEn: `You redeemed \"${reward.titleEn || reward.title}\" successfully.`,\n                data: JSON.stringify({\n                    voucherId: voucher.id\n                })\n            }\n        });\n        return next_server__WEBPACK_IMPORTED_MODULE_0__.NextResponse.json({\n            voucher\n        }, {\n            status: 201\n        });\n    } catch (error) {\n        console.error(\"Redeem error:\", error);\n        return next_server__WEBPACK_IMPORTED_MODULE_0__.NextResponse.json({\n            error: \"Internal server error\"\n        }, {\n            status: 500\n        });\n    }\n}\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKHJzYykvLi9zcmMvYXBwL2FwaS9yZXdhcmRzL1tpZF0vcmVkZWVtL3JvdXRlLnRzIiwibWFwcGluZ3MiOiI7Ozs7Ozs7OztBQUEwQztBQUNUO0FBQ087QUFDVDtBQUNKO0FBRXBCLGVBQWVLLEtBQ3BCQyxRQUFpQixFQUNqQixFQUFFQyxNQUFNLEVBQThCO0lBRXRDLElBQUk7UUFDRixNQUFNQyxPQUFPTixzREFBV0E7UUFDeEIsSUFBSSxDQUFDTSxNQUFNLE9BQU9SLHFEQUFZQSxDQUFDUyxJQUFJLENBQUM7WUFBRUMsT0FBTztRQUFlLEdBQUc7WUFBRUMsUUFBUTtRQUFJO1FBRTdFLE1BQU1DLFNBQVMsTUFBTVgsMkNBQU1BLENBQUNXLE1BQU0sQ0FBQ0MsVUFBVSxDQUFDO1lBQUVDLE9BQU87Z0JBQUVDLElBQUlSLE9BQU9RLEVBQUU7WUFBQztRQUFFO1FBQ3pFLElBQUksQ0FBQ0gsVUFBVSxDQUFDQSxPQUFPSSxRQUFRLEVBQUU7WUFDL0IsT0FBT2hCLHFEQUFZQSxDQUFDUyxJQUFJLENBQUM7Z0JBQUVDLE9BQU87WUFBK0IsR0FBRztnQkFBRUMsUUFBUTtZQUFJO1FBQ3BGO1FBQ0EsSUFBSUMsT0FBT0ssS0FBSyxJQUFJLEdBQUc7WUFDckIsT0FBT2pCLHFEQUFZQSxDQUFDUyxJQUFJLENBQUM7Z0JBQUVDLE9BQU87WUFBZSxHQUFHO2dCQUFFQyxRQUFRO1lBQUk7UUFDcEU7UUFFQSxNQUFNTyxPQUFPLE1BQU1qQiwyQ0FBTUEsQ0FBQ2lCLElBQUksQ0FBQ0wsVUFBVSxDQUFDO1lBQUVDLE9BQU87Z0JBQUVDLElBQUlQLEtBQUtXLE1BQU07WUFBQztRQUFFO1FBQ3ZFLElBQUksQ0FBQ0QsTUFBTSxPQUFPbEIscURBQVlBLENBQUNTLElBQUksQ0FBQztZQUFFQyxPQUFPO1FBQWlCLEdBQUc7WUFBRUMsUUFBUTtRQUFJO1FBRS9FLElBQUlPLEtBQUtFLFdBQVcsR0FBR1IsT0FBT1MsVUFBVSxFQUFFO1lBQ3hDLE9BQU9yQixxREFBWUEsQ0FBQ1MsSUFBSSxDQUFDO2dCQUFFQyxPQUFPO1lBQW9CLEdBQUc7Z0JBQUVDLFFBQVE7WUFBSTtRQUN6RTtRQUVBLG1CQUFtQjtRQUNuQixNQUFNVyxPQUFPbkIsOENBQU1BLENBQUMsSUFBSW9CLFdBQVc7UUFDbkMsTUFBTUMsWUFBWSxJQUFJQyxLQUFLQSxLQUFLQyxHQUFHLEtBQUssS0FBSyxLQUFLLEtBQUssS0FBSyxNQUFNLFVBQVU7O1FBRTVFLE1BQU1DLFlBQVlDLEtBQUtDLFNBQVMsQ0FBQztZQUMvQlA7WUFDQVEsVUFBVWxCLE9BQU9rQixRQUFRO1lBQ3pCQyxPQUFPbkIsT0FBT21CLEtBQUs7WUFDbkJQLFdBQVdBLFVBQVVRLFdBQVc7UUFDbEM7UUFDQSxNQUFNQyxTQUFTLE1BQU03Qiw2Q0FBZ0IsQ0FBQ3VCLFdBQVc7WUFBRVEsT0FBTztZQUFLQyxRQUFRO1FBQUU7UUFFekUsTUFBTSxDQUFDQyxRQUFRLEdBQUcsTUFBTXBDLDJDQUFNQSxDQUFDcUMsWUFBWSxDQUFDO1lBQzFDckMsMkNBQU1BLENBQUNvQyxPQUFPLENBQUNFLE1BQU0sQ0FBQztnQkFDcEJDLE1BQU07b0JBQ0pyQixRQUFRWCxLQUFLVyxNQUFNO29CQUNuQnNCLFVBQVU3QixPQUFPRyxFQUFFO29CQUNuQk87b0JBQ0FXO29CQUNBVDtnQkFDRjtnQkFDQWtCLFNBQVM7b0JBQUU5QixRQUFRO2dCQUFLO1lBQzFCO1lBQ0FYLDJDQUFNQSxDQUFDaUIsSUFBSSxDQUFDeUIsTUFBTSxDQUFDO2dCQUNqQjdCLE9BQU87b0JBQUVDLElBQUlQLEtBQUtXLE1BQU07Z0JBQUM7Z0JBQ3pCcUIsTUFBTTtvQkFBRXBCLGFBQWE7d0JBQUV3QixXQUFXaEMsT0FBT1MsVUFBVTtvQkFBQztnQkFBRTtZQUN4RDtZQUNBcEIsMkNBQU1BLENBQUNXLE1BQU0sQ0FBQytCLE1BQU0sQ0FBQztnQkFDbkI3QixPQUFPO29CQUFFQyxJQUFJSCxPQUFPRyxFQUFFO2dCQUFDO2dCQUN2QnlCLE1BQU07b0JBQUV2QixPQUFPO3dCQUFFMkIsV0FBVztvQkFBRTtnQkFBRTtZQUNsQztTQUNEO1FBRUQsZUFBZTtRQUNmLE1BQU0zQywyQ0FBTUEsQ0FBQzRDLFlBQVksQ0FBQ04sTUFBTSxDQUFDO1lBQy9CQyxNQUFNO2dCQUNKckIsUUFBUVgsS0FBS1csTUFBTTtnQkFDbkIyQixNQUFNO2dCQUNOQyxTQUFTO2dCQUNUQyxTQUFTO2dCQUNUQyxRQUFRLENBQUMsVUFBVSxFQUFFckMsT0FBT21CLEtBQUssQ0FBQyxTQUFTLENBQUM7Z0JBQzVDbUIsUUFBUSxDQUFDLGNBQWMsRUFBRXRDLE9BQU9vQyxPQUFPLElBQUlwQyxPQUFPbUIsS0FBSyxDQUFDLGVBQWUsQ0FBQztnQkFDeEVTLE1BQU1aLEtBQUtDLFNBQVMsQ0FBQztvQkFBRXNCLFdBQVdkLFFBQVF0QixFQUFFO2dCQUFDO1lBQy9DO1FBQ0Y7UUFFQSxPQUFPZixxREFBWUEsQ0FBQ1MsSUFBSSxDQUFDO1lBQUU0QjtRQUFRLEdBQUc7WUFBRTFCLFFBQVE7UUFBSTtJQUN0RCxFQUFFLE9BQU9ELE9BQU87UUFDZDBDLFFBQVExQyxLQUFLLENBQUMsaUJBQWlCQTtRQUMvQixPQUFPVixxREFBWUEsQ0FBQ1MsSUFBSSxDQUFDO1lBQUVDLE9BQU87UUFBd0IsR0FBRztZQUFFQyxRQUFRO1FBQUk7SUFDN0U7QUFDRiIsInNvdXJjZXMiOlsid2VicGFjazovL2Nhcm1hLy4vc3JjL2FwcC9hcGkvcmV3YXJkcy9baWRdL3JlZGVlbS9yb3V0ZS50cz9lMjBlIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IE5leHRSZXNwb25zZSB9IGZyb20gJ25leHQvc2VydmVyJ1xuaW1wb3J0IHsgcHJpc21hIH0gZnJvbSAnQC9saWIvZGInXG5pbXBvcnQgeyBnZXRBdXRoVXNlciB9IGZyb20gJ0AvbGliL2F1dGgnXG5pbXBvcnQgeyBuYW5vaWQgfSBmcm9tICduYW5vaWQnXG5pbXBvcnQgUVJDb2RlIGZyb20gJ3FyY29kZSdcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIFBPU1QoXG4gIF9yZXF1ZXN0OiBSZXF1ZXN0LFxuICB7IHBhcmFtcyB9OiB7IHBhcmFtczogeyBpZDogc3RyaW5nIH0gfVxuKSB7XG4gIHRyeSB7XG4gICAgY29uc3QgYXV0aCA9IGdldEF1dGhVc2VyKClcbiAgICBpZiAoIWF1dGgpIHJldHVybiBOZXh0UmVzcG9uc2UuanNvbih7IGVycm9yOiAnVW5hdXRob3JpemVkJyB9LCB7IHN0YXR1czogNDAxIH0pXG5cbiAgICBjb25zdCByZXdhcmQgPSBhd2FpdCBwcmlzbWEucmV3YXJkLmZpbmRVbmlxdWUoeyB3aGVyZTogeyBpZDogcGFyYW1zLmlkIH0gfSlcbiAgICBpZiAoIXJld2FyZCB8fCAhcmV3YXJkLmlzQWN0aXZlKSB7XG4gICAgICByZXR1cm4gTmV4dFJlc3BvbnNlLmpzb24oeyBlcnJvcjogJ1Jld2FyZCBub3QgZm91bmQgb3IgaW5hY3RpdmUnIH0sIHsgc3RhdHVzOiA0MDQgfSlcbiAgICB9XG4gICAgaWYgKHJld2FyZC5zdG9jayA8PSAwKSB7XG4gICAgICByZXR1cm4gTmV4dFJlc3BvbnNlLmpzb24oeyBlcnJvcjogJ091dCBvZiBzdG9jaycgfSwgeyBzdGF0dXM6IDQwOSB9KVxuICAgIH1cblxuICAgIGNvbnN0IHVzZXIgPSBhd2FpdCBwcmlzbWEudXNlci5maW5kVW5pcXVlKHsgd2hlcmU6IHsgaWQ6IGF1dGgudXNlcklkIH0gfSlcbiAgICBpZiAoIXVzZXIpIHJldHVybiBOZXh0UmVzcG9uc2UuanNvbih7IGVycm9yOiAnVXNlciBub3QgZm91bmQnIH0sIHsgc3RhdHVzOiA0MDQgfSlcblxuICAgIGlmICh1c2VyLnRvdGFsUG9pbnRzIDwgcmV3YXJkLnBvaW50c0Nvc3QpIHtcbiAgICAgIHJldHVybiBOZXh0UmVzcG9uc2UuanNvbih7IGVycm9yOiAnTm90IGVub3VnaCBwb2ludHMnIH0sIHsgc3RhdHVzOiA0MDIgfSlcbiAgICB9XG5cbiAgICAvLyBHZW5lcmF0ZSB2b3VjaGVyXG4gICAgY29uc3QgY29kZSA9IG5hbm9pZCgxMikudG9VcHBlckNhc2UoKVxuICAgIGNvbnN0IGV4cGlyZXNBdCA9IG5ldyBEYXRlKERhdGUubm93KCkgKyA5MCAqIDI0ICogNjAgKiA2MCAqIDEwMDApIC8vIDkwIGRheXNcblxuICAgIGNvbnN0IHFyUGF5bG9hZCA9IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgIGNvZGUsXG4gICAgICBidXNpbmVzczogcmV3YXJkLmJ1c2luZXNzLFxuICAgICAgdGl0bGU6IHJld2FyZC50aXRsZSxcbiAgICAgIGV4cGlyZXNBdDogZXhwaXJlc0F0LnRvSVNPU3RyaW5nKCksXG4gICAgfSlcbiAgICBjb25zdCBxckRhdGEgPSBhd2FpdCBRUkNvZGUudG9EYXRhVVJMKHFyUGF5bG9hZCwgeyB3aWR0aDogMjU2LCBtYXJnaW46IDEgfSlcblxuICAgIGNvbnN0IFt2b3VjaGVyXSA9IGF3YWl0IHByaXNtYS4kdHJhbnNhY3Rpb24oW1xuICAgICAgcHJpc21hLnZvdWNoZXIuY3JlYXRlKHtcbiAgICAgICAgZGF0YToge1xuICAgICAgICAgIHVzZXJJZDogYXV0aC51c2VySWQsXG4gICAgICAgICAgcmV3YXJkSWQ6IHJld2FyZC5pZCxcbiAgICAgICAgICBjb2RlLFxuICAgICAgICAgIHFyRGF0YSxcbiAgICAgICAgICBleHBpcmVzQXQsXG4gICAgICAgIH0sXG4gICAgICAgIGluY2x1ZGU6IHsgcmV3YXJkOiB0cnVlIH0sXG4gICAgICB9KSxcbiAgICAgIHByaXNtYS51c2VyLnVwZGF0ZSh7XG4gICAgICAgIHdoZXJlOiB7IGlkOiBhdXRoLnVzZXJJZCB9LFxuICAgICAgICBkYXRhOiB7IHRvdGFsUG9pbnRzOiB7IGRlY3JlbWVudDogcmV3YXJkLnBvaW50c0Nvc3QgfSB9LFxuICAgICAgfSksXG4gICAgICBwcmlzbWEucmV3YXJkLnVwZGF0ZSh7XG4gICAgICAgIHdoZXJlOiB7IGlkOiByZXdhcmQuaWQgfSxcbiAgICAgICAgZGF0YTogeyBzdG9jazogeyBkZWNyZW1lbnQ6IDEgfSB9LFxuICAgICAgfSksXG4gICAgXSlcblxuICAgIC8vIE5vdGlmaWNhdGlvblxuICAgIGF3YWl0IHByaXNtYS5ub3RpZmljYXRpb24uY3JlYXRlKHtcbiAgICAgIGRhdGE6IHtcbiAgICAgICAgdXNlcklkOiBhdXRoLnVzZXJJZCxcbiAgICAgICAgdHlwZTogJ3Jld2FyZCcsXG4gICAgICAgIHRpdGxlSGU6ICfXpNeo16Eg157Xldee16khJyxcbiAgICAgICAgdGl0bGVFbjogJ1Jld2FyZCBSZWRlZW1lZCEnLFxuICAgICAgICBib2R5SGU6IGDXnteZ157XqdeqINeQ16ogXCIke3Jld2FyZC50aXRsZX1cIiDXkdeU16bXnNeX15QuYCxcbiAgICAgICAgYm9keUVuOiBgWW91IHJlZGVlbWVkIFwiJHtyZXdhcmQudGl0bGVFbiB8fCByZXdhcmQudGl0bGV9XCIgc3VjY2Vzc2Z1bGx5LmAsXG4gICAgICAgIGRhdGE6IEpTT04uc3RyaW5naWZ5KHsgdm91Y2hlcklkOiB2b3VjaGVyLmlkIH0pLFxuICAgICAgfSxcbiAgICB9KVxuXG4gICAgcmV0dXJuIE5leHRSZXNwb25zZS5qc29uKHsgdm91Y2hlciB9LCB7IHN0YXR1czogMjAxIH0pXG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgY29uc29sZS5lcnJvcignUmVkZWVtIGVycm9yOicsIGVycm9yKVxuICAgIHJldHVybiBOZXh0UmVzcG9uc2UuanNvbih7IGVycm9yOiAnSW50ZXJuYWwgc2VydmVyIGVycm9yJyB9LCB7IHN0YXR1czogNTAwIH0pXG4gIH1cbn1cbiJdLCJuYW1lcyI6WyJOZXh0UmVzcG9uc2UiLCJwcmlzbWEiLCJnZXRBdXRoVXNlciIsIm5hbm9pZCIsIlFSQ29kZSIsIlBPU1QiLCJfcmVxdWVzdCIsInBhcmFtcyIsImF1dGgiLCJqc29uIiwiZXJyb3IiLCJzdGF0dXMiLCJyZXdhcmQiLCJmaW5kVW5pcXVlIiwid2hlcmUiLCJpZCIsImlzQWN0aXZlIiwic3RvY2siLCJ1c2VyIiwidXNlcklkIiwidG90YWxQb2ludHMiLCJwb2ludHNDb3N0IiwiY29kZSIsInRvVXBwZXJDYXNlIiwiZXhwaXJlc0F0IiwiRGF0ZSIsIm5vdyIsInFyUGF5bG9hZCIsIkpTT04iLCJzdHJpbmdpZnkiLCJidXNpbmVzcyIsInRpdGxlIiwidG9JU09TdHJpbmciLCJxckRhdGEiLCJ0b0RhdGFVUkwiLCJ3aWR0aCIsIm1hcmdpbiIsInZvdWNoZXIiLCIkdHJhbnNhY3Rpb24iLCJjcmVhdGUiLCJkYXRhIiwicmV3YXJkSWQiLCJpbmNsdWRlIiwidXBkYXRlIiwiZGVjcmVtZW50Iiwibm90aWZpY2F0aW9uIiwidHlwZSIsInRpdGxlSGUiLCJ0aXRsZUVuIiwiYm9keUhlIiwiYm9keUVuIiwidm91Y2hlcklkIiwiY29uc29sZSJdLCJzb3VyY2VSb290IjoiIn0=\n//# sourceURL=webpack-internal:///(rsc)/./src/app/api/rewards/[id]/redeem/route.ts\n");

/***/ }),

/***/ "(rsc)/./src/lib/auth.ts":
/*!*************************!*\
  !*** ./src/lib/auth.ts ***!
  \*************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   clearAuthCookie: () => (/* binding */ clearAuthCookie),\n/* harmony export */   getAuthUser: () => (/* binding */ getAuthUser),\n/* harmony export */   getTokenFromCookies: () => (/* binding */ getTokenFromCookies),\n/* harmony export */   setAuthCookie: () => (/* binding */ setAuthCookie),\n/* harmony export */   signToken: () => (/* binding */ signToken),\n/* harmony export */   userToPublic: () => (/* binding */ userToPublic),\n/* harmony export */   verifyToken: () => (/* binding */ verifyToken)\n/* harmony export */ });\n/* harmony import */ var jsonwebtoken__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! jsonwebtoken */ \"(rsc)/./node_modules/jsonwebtoken/index.js\");\n/* harmony import */ var jsonwebtoken__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(jsonwebtoken__WEBPACK_IMPORTED_MODULE_0__);\n/* harmony import */ var next_headers__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! next/headers */ \"(rsc)/./node_modules/next/dist/api/headers.js\");\n\n\nconst JWT_SECRET = process.env.JWT_SECRET || \"fallback-secret-do-not-use-in-production\";\nconst COOKIE_NAME = \"carma_token\";\nconst COOKIE_MAX_AGE = 60 * 60 * 24 * 7 // 7 days\n;\nfunction signToken(payload) {\n    return jsonwebtoken__WEBPACK_IMPORTED_MODULE_0___default().sign(payload, JWT_SECRET, {\n        expiresIn: \"7d\"\n    });\n}\nfunction verifyToken(token) {\n    try {\n        return jsonwebtoken__WEBPACK_IMPORTED_MODULE_0___default().verify(token, JWT_SECRET);\n    } catch  {\n        return null;\n    }\n}\nfunction setAuthCookie(token) {\n    const cookieStore = (0,next_headers__WEBPACK_IMPORTED_MODULE_1__.cookies)();\n    cookieStore.set(COOKIE_NAME, token, {\n        httpOnly: true,\n        secure: \"development\" === \"production\",\n        sameSite: \"lax\",\n        maxAge: COOKIE_MAX_AGE,\n        path: \"/\"\n    });\n}\nfunction clearAuthCookie() {\n    const cookieStore = (0,next_headers__WEBPACK_IMPORTED_MODULE_1__.cookies)();\n    cookieStore.delete(COOKIE_NAME);\n}\nfunction getTokenFromCookies() {\n    const cookieStore = (0,next_headers__WEBPACK_IMPORTED_MODULE_1__.cookies)();\n    return cookieStore.get(COOKIE_NAME)?.value ?? null;\n}\nfunction getAuthUser() {\n    const token = getTokenFromCookies();\n    if (!token) return null;\n    return verifyToken(token);\n}\nfunction userToPublic(user) {\n    return {\n        id: user.id,\n        name: user.name,\n        email: user.email,\n        phone: user.phone,\n        city: user.city,\n        age: user.age,\n        licenseYear: user.licenseYear,\n        totalPoints: user.totalPoints,\n        totalDistance: user.totalDistance,\n        level: user.level,\n        avatarUrl: user.avatarUrl,\n        createdAt: user.createdAt.toISOString()\n    };\n}\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKHJzYykvLi9zcmMvbGliL2F1dGgudHMiLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7OztBQUE4QjtBQUNRO0FBR3RDLE1BQU1FLGFBQWFDLFFBQVFDLEdBQUcsQ0FBQ0YsVUFBVSxJQUFJO0FBQzdDLE1BQU1HLGNBQWM7QUFDcEIsTUFBTUMsaUJBQWlCLEtBQUssS0FBSyxLQUFLLEVBQUUsU0FBUzs7QUFTMUMsU0FBU0MsVUFBVUMsT0FBd0M7SUFDaEUsT0FBT1Isd0RBQVEsQ0FBQ1EsU0FBU04sWUFBWTtRQUFFUSxXQUFXO0lBQUs7QUFDekQ7QUFFTyxTQUFTQyxZQUFZQyxLQUFhO0lBQ3ZDLElBQUk7UUFDRixPQUFPWiwwREFBVSxDQUFDWSxPQUFPVjtJQUMzQixFQUFFLE9BQU07UUFDTixPQUFPO0lBQ1Q7QUFDRjtBQUVPLFNBQVNZLGNBQWNGLEtBQWE7SUFDekMsTUFBTUcsY0FBY2QscURBQU9BO0lBQzNCYyxZQUFZQyxHQUFHLENBQUNYLGFBQWFPLE9BQU87UUFDbENLLFVBQVU7UUFDVkMsUUFBUWYsa0JBQXlCO1FBQ2pDZ0IsVUFBVTtRQUNWQyxRQUFRZDtRQUNSZSxNQUFNO0lBQ1I7QUFDRjtBQUVPLFNBQVNDO0lBQ2QsTUFBTVAsY0FBY2QscURBQU9BO0lBQzNCYyxZQUFZUSxNQUFNLENBQUNsQjtBQUNyQjtBQUVPLFNBQVNtQjtJQUNkLE1BQU1ULGNBQWNkLHFEQUFPQTtJQUMzQixPQUFPYyxZQUFZVSxHQUFHLENBQUNwQixjQUFjcUIsU0FBUztBQUNoRDtBQUVPLFNBQVNDO0lBQ2QsTUFBTWYsUUFBUVk7SUFDZCxJQUFJLENBQUNaLE9BQU8sT0FBTztJQUNuQixPQUFPRCxZQUFZQztBQUNyQjtBQUVPLFNBQVNnQixhQUFhQyxJQWE1QjtJQUNDLE9BQU87UUFDTEMsSUFBSUQsS0FBS0MsRUFBRTtRQUNYQyxNQUFNRixLQUFLRSxJQUFJO1FBQ2ZDLE9BQU9ILEtBQUtHLEtBQUs7UUFDakJDLE9BQU9KLEtBQUtJLEtBQUs7UUFDakJDLE1BQU1MLEtBQUtLLElBQUk7UUFDZkMsS0FBS04sS0FBS00sR0FBRztRQUNiQyxhQUFhUCxLQUFLTyxXQUFXO1FBQzdCQyxhQUFhUixLQUFLUSxXQUFXO1FBQzdCQyxlQUFlVCxLQUFLUyxhQUFhO1FBQ2pDQyxPQUFPVixLQUFLVSxLQUFLO1FBQ2pCQyxXQUFXWCxLQUFLVyxTQUFTO1FBQ3pCQyxXQUFXWixLQUFLWSxTQUFTLENBQUNDLFdBQVc7SUFDdkM7QUFDRiIsInNvdXJjZXMiOlsid2VicGFjazovL2Nhcm1hLy4vc3JjL2xpYi9hdXRoLnRzPzY2OTIiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IGp3dCBmcm9tICdqc29ud2VidG9rZW4nXG5pbXBvcnQgeyBjb29raWVzIH0gZnJvbSAnbmV4dC9oZWFkZXJzJ1xuaW1wb3J0IHR5cGUgeyBVc2VyIH0gZnJvbSAnQC90eXBlcydcblxuY29uc3QgSldUX1NFQ1JFVCA9IHByb2Nlc3MuZW52LkpXVF9TRUNSRVQgfHwgJ2ZhbGxiYWNrLXNlY3JldC1kby1ub3QtdXNlLWluLXByb2R1Y3Rpb24nXG5jb25zdCBDT09LSUVfTkFNRSA9ICdjYXJtYV90b2tlbidcbmNvbnN0IENPT0tJRV9NQVhfQUdFID0gNjAgKiA2MCAqIDI0ICogNyAvLyA3IGRheXNcblxuZXhwb3J0IGludGVyZmFjZSBKd3RQYXlsb2FkIHtcbiAgdXNlcklkOiBzdHJpbmdcbiAgZW1haWw6IHN0cmluZ1xuICBpYXQ/OiBudW1iZXJcbiAgZXhwPzogbnVtYmVyXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzaWduVG9rZW4ocGF5bG9hZDogT21pdDxKd3RQYXlsb2FkLCAnaWF0JyB8ICdleHAnPik6IHN0cmluZyB7XG4gIHJldHVybiBqd3Quc2lnbihwYXlsb2FkLCBKV1RfU0VDUkVULCB7IGV4cGlyZXNJbjogJzdkJyB9KVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmVyaWZ5VG9rZW4odG9rZW46IHN0cmluZyk6IEp3dFBheWxvYWQgfCBudWxsIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gand0LnZlcmlmeSh0b2tlbiwgSldUX1NFQ1JFVCkgYXMgSnd0UGF5bG9hZFxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzZXRBdXRoQ29va2llKHRva2VuOiBzdHJpbmcpOiB2b2lkIHtcbiAgY29uc3QgY29va2llU3RvcmUgPSBjb29raWVzKClcbiAgY29va2llU3RvcmUuc2V0KENPT0tJRV9OQU1FLCB0b2tlbiwge1xuICAgIGh0dHBPbmx5OiB0cnVlLFxuICAgIHNlY3VyZTogcHJvY2Vzcy5lbnYuTk9ERV9FTlYgPT09ICdwcm9kdWN0aW9uJyxcbiAgICBzYW1lU2l0ZTogJ2xheCcsXG4gICAgbWF4QWdlOiBDT09LSUVfTUFYX0FHRSxcbiAgICBwYXRoOiAnLycsXG4gIH0pXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjbGVhckF1dGhDb29raWUoKTogdm9pZCB7XG4gIGNvbnN0IGNvb2tpZVN0b3JlID0gY29va2llcygpXG4gIGNvb2tpZVN0b3JlLmRlbGV0ZShDT09LSUVfTkFNRSlcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldFRva2VuRnJvbUNvb2tpZXMoKTogc3RyaW5nIHwgbnVsbCB7XG4gIGNvbnN0IGNvb2tpZVN0b3JlID0gY29va2llcygpXG4gIHJldHVybiBjb29raWVTdG9yZS5nZXQoQ09PS0lFX05BTUUpPy52YWx1ZSA/PyBudWxsXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRBdXRoVXNlcigpOiBKd3RQYXlsb2FkIHwgbnVsbCB7XG4gIGNvbnN0IHRva2VuID0gZ2V0VG9rZW5Gcm9tQ29va2llcygpXG4gIGlmICghdG9rZW4pIHJldHVybiBudWxsXG4gIHJldHVybiB2ZXJpZnlUb2tlbih0b2tlbilcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHVzZXJUb1B1YmxpYyh1c2VyOiB7XG4gIGlkOiBzdHJpbmdcbiAgbmFtZTogc3RyaW5nXG4gIGVtYWlsOiBzdHJpbmdcbiAgcGhvbmU/OiBzdHJpbmcgfCBudWxsXG4gIGNpdHk/OiBzdHJpbmcgfCBudWxsXG4gIGFnZT86IG51bWJlciB8IG51bGxcbiAgbGljZW5zZVllYXI/OiBudW1iZXIgfCBudWxsXG4gIHRvdGFsUG9pbnRzOiBudW1iZXJcbiAgdG90YWxEaXN0YW5jZTogbnVtYmVyXG4gIGxldmVsOiBudW1iZXJcbiAgYXZhdGFyVXJsPzogc3RyaW5nIHwgbnVsbFxuICBjcmVhdGVkQXQ6IERhdGVcbn0pOiBVc2VyIHtcbiAgcmV0dXJuIHtcbiAgICBpZDogdXNlci5pZCxcbiAgICBuYW1lOiB1c2VyLm5hbWUsXG4gICAgZW1haWw6IHVzZXIuZW1haWwsXG4gICAgcGhvbmU6IHVzZXIucGhvbmUsXG4gICAgY2l0eTogdXNlci5jaXR5LFxuICAgIGFnZTogdXNlci5hZ2UsXG4gICAgbGljZW5zZVllYXI6IHVzZXIubGljZW5zZVllYXIsXG4gICAgdG90YWxQb2ludHM6IHVzZXIudG90YWxQb2ludHMsXG4gICAgdG90YWxEaXN0YW5jZTogdXNlci50b3RhbERpc3RhbmNlLFxuICAgIGxldmVsOiB1c2VyLmxldmVsLFxuICAgIGF2YXRhclVybDogdXNlci5hdmF0YXJVcmwsXG4gICAgY3JlYXRlZEF0OiB1c2VyLmNyZWF0ZWRBdC50b0lTT1N0cmluZygpLFxuICB9XG59XG4iXSwibmFtZXMiOlsiand0IiwiY29va2llcyIsIkpXVF9TRUNSRVQiLCJwcm9jZXNzIiwiZW52IiwiQ09PS0lFX05BTUUiLCJDT09LSUVfTUFYX0FHRSIsInNpZ25Ub2tlbiIsInBheWxvYWQiLCJzaWduIiwiZXhwaXJlc0luIiwidmVyaWZ5VG9rZW4iLCJ0b2tlbiIsInZlcmlmeSIsInNldEF1dGhDb29raWUiLCJjb29raWVTdG9yZSIsInNldCIsImh0dHBPbmx5Iiwic2VjdXJlIiwic2FtZVNpdGUiLCJtYXhBZ2UiLCJwYXRoIiwiY2xlYXJBdXRoQ29va2llIiwiZGVsZXRlIiwiZ2V0VG9rZW5Gcm9tQ29va2llcyIsImdldCIsInZhbHVlIiwiZ2V0QXV0aFVzZXIiLCJ1c2VyVG9QdWJsaWMiLCJ1c2VyIiwiaWQiLCJuYW1lIiwiZW1haWwiLCJwaG9uZSIsImNpdHkiLCJhZ2UiLCJsaWNlbnNlWWVhciIsInRvdGFsUG9pbnRzIiwidG90YWxEaXN0YW5jZSIsImxldmVsIiwiYXZhdGFyVXJsIiwiY3JlYXRlZEF0IiwidG9JU09TdHJpbmciXSwic291cmNlUm9vdCI6IiJ9\n//# sourceURL=webpack-internal:///(rsc)/./src/lib/auth.ts\n");

/***/ }),

/***/ "(rsc)/./src/lib/db.ts":
/*!***********************!*\
  !*** ./src/lib/db.ts ***!
  \***********************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   \"default\": () => (__WEBPACK_DEFAULT_EXPORT__),\n/* harmony export */   prisma: () => (/* binding */ prisma)\n/* harmony export */ });\n/* harmony import */ var _prisma_client__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! @prisma/client */ \"@prisma/client\");\n/* harmony import */ var _prisma_client__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(_prisma_client__WEBPACK_IMPORTED_MODULE_0__);\n\nconst globalForPrisma = globalThis;\nconst prisma = globalForPrisma.prisma ?? new _prisma_client__WEBPACK_IMPORTED_MODULE_0__.PrismaClient({\n    log:  true ? [\n        \"error\",\n        \"warn\"\n    ] : 0\n});\nif (true) globalForPrisma.prisma = prisma;\n/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (prisma);\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKHJzYykvLi9zcmMvbGliL2RiLnRzIiwibWFwcGluZ3MiOiI7Ozs7Ozs7QUFBNkM7QUFFN0MsTUFBTUMsa0JBQWtCQztBQUlqQixNQUFNQyxTQUNYRixnQkFBZ0JFLE1BQU0sSUFDdEIsSUFBSUgsd0RBQVlBLENBQUM7SUFDZkksS0FBS0MsS0FBeUIsR0FBZ0I7UUFBQztRQUFTO0tBQU8sR0FBRyxDQUFTO0FBQzdFLEdBQUU7QUFFSixJQUFJQSxJQUF5QixFQUFjSixnQkFBZ0JFLE1BQU0sR0FBR0E7QUFFcEUsaUVBQWVBLE1BQU1BLEVBQUEiLCJzb3VyY2VzIjpbIndlYnBhY2s6Ly9jYXJtYS8uL3NyYy9saWIvZGIudHM/OWU0ZiJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBQcmlzbWFDbGllbnQgfSBmcm9tICdAcHJpc21hL2NsaWVudCdcblxuY29uc3QgZ2xvYmFsRm9yUHJpc21hID0gZ2xvYmFsVGhpcyBhcyB1bmtub3duIGFzIHtcbiAgcHJpc21hOiBQcmlzbWFDbGllbnQgfCB1bmRlZmluZWRcbn1cblxuZXhwb3J0IGNvbnN0IHByaXNtYSA9XG4gIGdsb2JhbEZvclByaXNtYS5wcmlzbWEgPz9cbiAgbmV3IFByaXNtYUNsaWVudCh7XG4gICAgbG9nOiBwcm9jZXNzLmVudi5OT0RFX0VOViA9PT0gJ2RldmVsb3BtZW50JyA/IFsnZXJyb3InLCAnd2FybiddIDogWydlcnJvciddLFxuICB9KVxuXG5pZiAocHJvY2Vzcy5lbnYuTk9ERV9FTlYgIT09ICdwcm9kdWN0aW9uJykgZ2xvYmFsRm9yUHJpc21hLnByaXNtYSA9IHByaXNtYVxuXG5leHBvcnQgZGVmYXVsdCBwcmlzbWFcbiJdLCJuYW1lcyI6WyJQcmlzbWFDbGllbnQiLCJnbG9iYWxGb3JQcmlzbWEiLCJnbG9iYWxUaGlzIiwicHJpc21hIiwibG9nIiwicHJvY2VzcyJdLCJzb3VyY2VSb290IjoiIn0=\n//# sourceURL=webpack-internal:///(rsc)/./src/lib/db.ts\n");

/***/ })

};
;

// load runtime
var __webpack_require__ = require("../../../../../webpack-runtime.js");
__webpack_require__.C(exports);
var __webpack_exec__ = (moduleId) => (__webpack_require__(__webpack_require__.s = moduleId))
var __webpack_exports__ = __webpack_require__.X(0, ["vendor-chunks/next","vendor-chunks/semver","vendor-chunks/jsonwebtoken","vendor-chunks/lodash.includes","vendor-chunks/jws","vendor-chunks/lodash.once","vendor-chunks/jwa","vendor-chunks/lodash.isinteger","vendor-chunks/ecdsa-sig-formatter","vendor-chunks/lodash.isplainobject","vendor-chunks/ms","vendor-chunks/lodash.isstring","vendor-chunks/lodash.isnumber","vendor-chunks/lodash.isboolean","vendor-chunks/safe-buffer","vendor-chunks/buffer-equal-constant-time","vendor-chunks/qrcode","vendor-chunks/pngjs","vendor-chunks/nanoid","vendor-chunks/dijkstrajs"], () => (__webpack_exec__("(rsc)/./node_modules/next/dist/build/webpack/loaders/next-app-loader.js?name=app%2Fapi%2Frewards%2F%5Bid%5D%2Fredeem%2Froute&page=%2Fapi%2Frewards%2F%5Bid%5D%2Fredeem%2Froute&appPaths=&pagePath=private-next-app-dir%2Fapi%2Frewards%2F%5Bid%5D%2Fredeem%2Froute.ts&appDir=C%3A%5CUsers%5Ctzvai%5COneDrive%5CBSc%5Cyear_3%5Cworkshop%5Ccarma%5Csrc%5Capp&pageExtensions=tsx&pageExtensions=ts&pageExtensions=jsx&pageExtensions=js&rootDir=C%3A%5CUsers%5Ctzvai%5COneDrive%5CBSc%5Cyear_3%5Cworkshop%5Ccarma&isDev=true&tsconfigPath=tsconfig.json&basePath=&assetPrefix=&nextConfigOutput=standalone&preferredRegion=&middlewareConfig=e30%3D!")));
module.exports = __webpack_exports__;

})();