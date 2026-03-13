const escpos = require('escpos');
escpos.USB = require('escpos-usb');

const device = new escpos.USB();
const printer = new escpos.Printer(device);

class Printer {

    constructor() {
        console.log("Printer instance created successfully");
        this.device = device;
        this.printer = printer;
    }

    generateBill(orderData, tableId = null, orderType = "TABLE") {

        const { order, order_total, person } = orderData;

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
        billText += "   Thank You Visit Again\n\n\n";

        return billText;
    }



    async printBill(billText) {

        try {

            const device = this.device;
            const printer = this.printer;

            device.open(function () {

                printer
                    .align("CT")
                    .text(billText)
                    .cut()
                    .close();

            });

        } catch (err) {

            console.log("Printer Error:", err);

        }

    }


}





module.exports = {
    generateBill,
    printBill
};