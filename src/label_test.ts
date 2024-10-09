
import {createPdf} from "./labelCreator"

import { promisify } from "util";
const { exec } = require("child_process");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const printer = require("pdf-to-printer");

async function main() {
createPdf("TestOrder", "myTest.pdf","data/myFile")
            .then((filePath : any) => {
                console.log("print file");
                return printer.print("myTest.pdf", {
                    printer: 'vertti', // Setze den Druckernamen falls nötig
                    orientation : "landscape",
                    paperSize: "label",
                    scale: "fit",
                    //win32: ["-print-settings", "fit"]  // Windows-spezifische Einstellungen, z.B. "fit" für Papiergrößenanpassung
                }); // Ersetze "printer_name" mit deinem tatsächlichen Druckernamen*/
            })
            .then(() => {
                console.log("Druckauftrag erfolgreich gesendet!");
                // Erfolgreiche Rückgabe an den Client
            })
            .catch((error : any) => {
                console.log(error);
            });

        }
// Führe die Hauptfunktion aus
main().catch((error) => {
    console.error("Error: ", error);
});
