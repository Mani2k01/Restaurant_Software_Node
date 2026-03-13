const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

class PDFBill {

    constructor() {
        console.log("PDF Bill instance created successfully");
    }

    generateBill(orderData, tableId = null, orderType) {

        const order = orderData.order || orderData.items;
        const order_total = orderData.order_total || orderData.total;
        const person = orderData.person || orderData.customer;

        let billText = "";

        billText += "==============================\n";
        billText += "         RESTAURANT\n";
        billText += "==============================\n";

        billText += `Order Type : ${orderType}\n`;

        if (tableId) {
            billText += `Table      : ${tableId}\n`;
        }

        billText += `Customer   : ${person}\n`;
        billText += "------------------------------\n";
        billText += "Item           Qty   Price\n";
        billText += "------------------------------\n";

        Object.entries(order).forEach(([name, item]) => {

            const itemName = name.padEnd(14);
            const qty = String(item.qty).padEnd(5);
            const total = String(item.total).padStart(5);

            billText += `${itemName}${qty}${total}\n`;

        });

        billText += "------------------------------\n";
        billText += `TOTAL                 ₹${order_total}\n`;
        billText += "------------------------------\n";
        billText += "   Thank You Visit Again\n";

        return billText;
    }



    async saveBillPDF(billText, tableId) {

        try {

            const downloads = path.join(
                require("os").homedir(),
                "Downloads",
                `bill_${tableId}.pdf`
            );

            const doc = new PDFDocument({
                size: [300, 500], 
                margin: 20
            });

            const stream = fs.createWriteStream(downloads);

            doc.pipe(stream);

            doc
                .font("Courier")
                .fontSize(10)
                .text(billText);

            doc.end();

            stream.on("finish", () => {
                console.log("Bill saved to:", downloads);
            });

        } catch (err) {
            console.log("PDF Error:", err);
        }

    }

}

module.exports = PDFBill;