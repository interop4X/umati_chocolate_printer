"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var node_opcua_1 = require("node-opcua");
var path = require("path");
// Hauptfunktion zur Erstellung des OPC UA Servers
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var xmlFiles, server;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    xmlFiles = [
                        node_opcua_1.nodesets.standard, // Standard OPC UA Nodeset
                        path.join(__dirname, "..", "models", "Opc.Ua.Di.NodeSet2.xml"), // DI Nodeset
                        path.join(__dirname, "..", "models", "opc.ua.isa95-jobcontrol.nodeset2.xml"), // ISA95-JobControl Nodeset
                        path.join(__dirname, "..", "models", "Opc.Ua.Machinery.Jobs.NodeSet2.xml"), // Machinery Jobs Nodeset
                        path.join(__dirname, "..", "models", "Opc.Ua.Machinery.NodeSet2.xml"), // Machinery Nodeset
                        //path.join(__dirname, "..", "models", "opc.ua.glas.v2.nodeset2.xml"), // Glas Nodeset
                    ];
                    server = new node_opcua_1.OPCUAServer({
                        port: 48400, // Der Port, auf dem der Server läuft
                        resourcePath: "/UA/ChocoCuttingTable", // Endpunkt
                        buildInfo: {
                            productName: "interop4X - Choco Cutting Table",
                            buildNumber: "1",
                            buildDate: new Date(),
                        },
                        nodeset_filename: xmlFiles, // Die Nodeset-Dateien werden hier übergeben
                    });
                    // Initialisiere den Server
                    return [4 /*yield*/, server.initialize()];
                case 1:
                    // Initialisiere den Server
                    _a.sent();
                    // Starte den Server
                    return [4 /*yield*/, server.start()];
                case 2:
                    // Starte den Server
                    _a.sent();
                    console.log("OPC UA Server läuft! Drücke Strg+C zum Beenden.");
                    // Endpunkt anzeigen
                    console.log("Server is now listening on: ", server.getEndpointUrl());
                    return [2 /*return*/];
            }
        });
    });
}
// Führe die Hauptfunktion aus
main().catch(function (error) {
    console.error("Error: ", error);
});
