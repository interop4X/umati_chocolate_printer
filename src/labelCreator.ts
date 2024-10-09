import { Console, log } from "console";
import { NodeId, NodeIdType, OPCUAServer, UAFile, nodesets, UAMethod, StatusCodes, UAVariable, DataType, Variant, BrowsePath, VariantArrayType, BaseNode, LocalizedText, UAObject } from "node-opcua";
import * as path from "path";
import { MachineryItemState } from "./machineryItemState";
import { FileBaseSystem, RootDict, File } from "./file";

import { promisify } from "util";
import sharp from "sharp";
const SVGtoPDF = require('svg-to-pdfkit');
const { exec } = require("child_process");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const printer = require("pdf-to-printer");

PDFDocument.prototype.addSVG = function(svg :any, x:any, y:any, options:any) {
    return SVGtoPDF(this, svg, x, y, options), this;
  };

function generateSvgArc(arcData:any,x:number,y:number) {
    /*const arcData = {
      StartPoint: { Y: 1000 },
      EndPoint: { X: 310.00538212223745, Y: 1063.1923003595216 },
      CenterPoint: { X: 310.0053821222374, Y: 271.1923003595216 }
    };*/
  
    const startX = (arcData.StartPoint.X ?? 0 )+ x; // Der X-Wert des Startpunkts wurde im JSON nicht angegeben, ich nehme an, dass es 0 ist.
    const startY = (arcData.StartPoint.Y ?? 0 )+ y;
    const endX = (arcData.EndPoint.X ?? 0 )+ x;
    const endY = (arcData.EndPoint.Y ?? 0 ) + y ;
    const centerX = (arcData.CenterPoint.X ?? 0) + x;
    const centerY = (arcData.CenterPoint.Y ?? 0) + y;
  
    // Berechnung des Radius: Abstand zwischen Startpunkt und Mittelpunkt
    let radius = Math.sqrt((startX - centerX) ** 2 + (startY - centerY) ** 2);

  
    // SVG-Bogen (mit "A" Befehl)
    const svgPath = `
        <path d="M ${startX} ${startY} A ${radius} ${radius} 0 0 0 ${endX} ${endY}" fill="none" stroke="black" />
    `;
  
    return svgPath;
  }

  

export function createPdf(JobOrderId: string, outputPath: string, jobFile: string) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({
            size: [40, 90]
        });

        const writeStream = fs.createWriteStream(outputPath);
        doc.pipe(writeStream);
        doc.fontSize(5)

        doc.image('images/interop4X.png', 1, 5, {fit: [20, 20]})
        doc.image('images/qrcode.png', 21, 5, {fit: [20, 20]})

        doc.fontSize(3)
        const url = "htttp://interop4X.de";
        const textWidth = doc.widthOfString("htttp://interop4X.de");
        const centeredX = 21 - (textWidth / 2);
        doc.text(url,centeredX,26,{
            align: 'center',
        });

        doc.fontSize(5)
        // Füge den JobOrderId in die PDF-Datei ein
        const textWidth2 = doc.widthOfString(JobOrderId);
        const centeredX2 = 21 - (textWidth2 / 2);
        doc.text(JobOrderId,centeredX,50,{
            align: 'center',
        });

        // Lies den Inhalt der jobFile und füge ihn ins PDF ein
        fs.readFile(jobFile, 'utf8', (err: any, fileContent: string) => {
            if (err) {
                return reject(`Fehler beim Lesen der Datei: ${err}`);
            }
            try {
                readJtd(fileContent, doc);
            } catch (error) {
                
            }


            // PDF-Dokument abschließen, nachdem der Inhalt eingefügt wurde
            doc.end();
        });

        // Auf Abschluss des WriteStreams warten
        writeStream.on("finish", () => {
            resolve(outputPath);
        });

        writeStream.on("error", (err:any) => {
            reject(`Fehler beim Schreiben der PDF-Datei: ${err}`);
        });
    });
}
function readJtd(fileContent: string, doc: any) {
    var jtd = JSON.parse(fileContent);
    var width = jtd.Recipe[0].CuttingInstruction.Output.Layout.Width;
    var height = jtd.Recipe[0].CuttingInstruction.Output.Layout.Height;
    var svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 ${width} ${height}">`;
    var rect = jtd.Recipe[0].CuttingInstruction.Output.Layout.InnerRectangle;
    for (var i in rect) {
        //console.log("loop1");
        //console.log(rect[i]);
        var rect_width = rect[i].Width;
        var rect_height = rect[i].Height;
        var before = (i as any) - 1;
        var rect_x = (rect[i].P0.X | 0);
        var rect_y = (rect[i].P0.Y | 0);
        /*if (rect[before-1]){
            console.log("yes");
            rect_x +=  (rect[before-1].x  | 0);
            rect_y +=  (rect[before-1].y  | 0);
        }*/
        rect[i].x = rect_x;
        rect[i].y = rect_y;
        svg += `<rect x="${rect_x}" y="${rect_y}" width="${rect_width}" height="${rect_height}" stroke-width="1" fill="none" stroke="black"/>
                `;
        if (rect[i].InnerRectangle) {
            //console.log("loop2");
            for (var rect2 in rect[i].InnerRectangle) {
                var rect2_width = rect[i].InnerRectangle[rect2].Width;
                var rect2_height = rect[i].InnerRectangle[rect2].Height;
                const rect2_x = (rect[i]?.InnerRectangle?.[rect2]?.P0?.X ?? 0) + rect_x;
                const rect2_y = (rect[i].InnerRectangle?.[rect2]?.P0?.Y ?? 0) + rect_y;
                svg += `<rect x="${rect2_x}" y="${rect2_y}" width="${rect2_width}" height="${rect2_height}" stroke-width="1" fill="none" stroke="red"/>
                        `;
                if (rect[i].InnerRectangle[rect2].InstanceOf) {
                    var globalrect = jtd.Recipe[0].GlobalRectangle.find((x: any) => x.Identification == rect[i].InnerRectangle[rect2].InstanceOf);
                    //console.log(globalrect);
                    var globalProduct = jtd.Recipe[0].GlobalProduct.find((x: any) => x.Identification == globalrect.Product[0].InstanceOf);
                    //console.log(globalProduct);
                    var shape = jtd.Recipe[0].GlobalGeometryPath.find((x: any) => x.Identification == globalProduct.BoM.Shape.InstanceOf);
                    console.log(shape);
                    for (var el in shape.Element) {
                        var element = shape.Element[el];
                        //console.log("newlloop");
                        //console.log(element);
                        if (element.Line) {
                            const x1 = (element.Line.StartPoint.X ?? 0) + rect2_x;
                            const y1 = (element.Line.StartPoint.Y ?? 0) + rect2_y;
                            const x2 = (element.Line.EndPoint.X ?? 0) + rect2_x;
                            const y2 = (element.Line.EndPoint.Y ?? 0) + rect2_y;
                            svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" style="stroke:black;stroke-width:8" />`;
                        }
                        if (element.Arc) {
                            svg += generateSvgArc(element.Arc, rect2_x, rect2_y);
                        }
                    }

                }
            }
        }

    }
    svg += `
            </svg>`;

    doc.addSVG(svg, 5, 60, {
        width: 40,
        height: 40
    });
}

