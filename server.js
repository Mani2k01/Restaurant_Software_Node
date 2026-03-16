const express = require("express");
const cors = require("cors");
const path = require("path");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const Database = require("./db");
const pdfBill = require("./bill_pdf");
// const Printer = require("./printer");
// const NetworkPrinter = require("./printer_ip");

// for env variables
require('dotenv').config();


// GLOBAL ERROR LOGGING
process.on("uncaughtException", (err) => {
  console.error("🔥 UNCAUGHT EXCEPTION:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("🔥 UNHANDLED PROMISE REJECTION:", err);
});

const app = express();

app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

const db = new Database();
const billPDF = new pdfBill();
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(
  session({
    secret: process.env.SECRET_KEY,   
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } 
  })
);

const PORT = process.env.NODE_PORT ;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());


app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(path.join(__dirname, "public")));


app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "Home.html"));
});


app.route("/table_order")
    .get(async (req, res) => {
        let tables = await fetch_table_status();
        res.render("Table_order", { tables });
    })
    .post(async (req, res) => {
        console.log("Received POST request to /table_order with body:", req.body);
        const { table_id, persons } = req.body;    
        console.log("Received data:", { table_id, persons });

        req.session.current_table = {
            table: table_id,
            persons: persons,
            status: "YET TO ORDER"
        };
        const query = "UPDATE dine_tables SET table_status = $1, persons = $2 WHERE table_id = $3";
        const values = ["YET TO ORDER", persons, table_id];

        await db.update_data(query, values);
        // Here you can process the order and save it to the database
        res.redirect("/order_entry");
        // res.status(200).json({ message: "Order placed successfully" });
    });


app.route("/order_entry")
    .get(async(req, res) => {
        const table_ctx = req.session.current_table;
        const order_id = req.session.order_id;
        const orders_by_table = req.session.orders_by_table || {};

        if (!table_ctx) {
            return res.redirect("/table_order");
        }

        const table_id = table_ctx.table;
        const order_person = req.session.order_name || "";
        let active_order = orders_by_table[table_id]?.order || {};

        // if session lost but order exists in DB
        if (Object.keys(active_order).length === 0) {

            const query = `
                SELECT order_items, order_id
                FROM food_order
                WHERE table_id=$1
                AND order_status != 'PAID'
                ORDER BY order_id DESC
                LIMIT 1
            `;

            const result = await db.fetch_all_data(query, [table_id]);

            if (result.length > 0) {

                const orderRow = result[0];

                active_order = typeof orderRow.order_items === "string"
                    ? JSON.parse(orderRow.order_items)
                    : orderRow.order_items;

                req.session.order_id = orderRow.order_id;
            }
        }

        // Fetch food items from DB
        const foods = await fetch_food_items();

        // console.log("Fetched food items:", foods);
        console.log("order id after confirm order, fetched from session : ", req.session.order_id);
        console.log("order id after confirm order : ", order_id);
        res.render("Order_Entry", {
            order: table_ctx,
            foods,
            active_order,
            order_person,
            order_id
        });
    })
    .post(async (req, res) => {
        console.log("Received POST request to /order_entry ");
       const order_name = req.body.order_name;
        const action = req.body.action;
        const table_id = req.body.table_no;
        const order_data = JSON.parse(req.body.order_data);
        const order_id = req.session.order_id;

        let orders_by_table = req.session.orders_by_table || {};

        // mark all items as ORDERED
        Object.values(order_data).forEach(item => {
            item.status = "ORDERED";
        });

        // calculate total
        const order_total = Object.values(order_data)
            .reduce((sum, item) => sum + item.total, 0);

        req.session.order_name = order_name;

        // save order in session
        orders_by_table[table_id] = {
            order: order_data,
            order_total: order_total,
            person: order_name
        };

        req.session.orders_by_table = orders_by_table;

        try {
            if (action === "submit") {
                const query = ` INSERT INTO food_order (table_id, name, order_amount, order_items, order_type) VALUES ($1,$2,$3,$4,$5) `;
                const values = [
                    table_id,
                    order_name,
                    order_total,
                    JSON.stringify(order_data),
                    "TABLE"
                ];
                const result = await db.insert_data(query, values);
                if (result) {
                    await db.update_data( " UPDATE dine_tables SET table_status=$1 WHERE table_id=$2", ["OCCUPIED", table_id] );

                    req.session.current_table = {
                        ...req.session.current_table,
                        status: "OCCUPIED"
                    };

                    const orderResult = await db.fetch_data(
                        "SELECT order_id FROM food_order WHERE table_id=$1 ORDER BY order_id DESC LIMIT 1",
                        [table_id]
                    );
                    const order_id = orderResult[0]?.order_id;

                    req.session.order_id = order_id;

                    return res.redirect("/order_entry");
                }
            }

            else if (action === "print") {
                console.log("Bill generation requested for table", table_id);
                console.log("Order details:", orders_by_table[table_id]);
                const billtext = billPDF.generateBill(orders_by_table[table_id], table_id, "TABLE");
                await billPDF.saveBillPDF(billtext, table_id);
                res.json({ message: "Bill saved to Downloads" });
                // res.status(200).json({ message: "Bill Generating..." });
            }

            else if (action === "pay") {
                console.log("Pay route called");
                const current = orders_by_table[table_id];

                if (!current) {
                    req.session.js_alert = "No active order";
                    return res.redirect("/order_entry");
                }

                await db.update_data(
                    "UPDATE food_order SET order_status='PAID' WHERE order_id=$1",
                    [order_id]
                );

                await db.update_data(
                    "UPDATE dine_tables SET table_status='CLEANING', persons=0 WHERE table_id=$1",
                    [table_id]
                );

                delete orders_by_table[table_id];

                req.session.orders_by_table = orders_by_table;

                req.session.js_alert = "Payment successful. Order closed.";

                return res.redirect("/order_entry");
            }

        } catch (err) {
            console.error("Order error:", err);
            res.status(500).send("Order processing failed");
        }
    });



app.route("/parcel")
    .get(async (req, res) => {

        // Fetch food items from DB
        const foods = await fetch_food_items();

        const parcel = req.session.parcel_order || null;
        console.log(" fetched parcel order session:", parcel);
        res.render("parcel", {
            foods,
            parcel
        });

    })

    .post(async (req, res) => {

        try {

            const order_name = req.body.order_name;
            const action = req.body.action;

            const order = JSON.parse(req.body.order_data);

            const order_total = Object.values(order)
                .reduce((sum, item) => sum + item.total, 0);

            const order_items_json = JSON.stringify(order);

            if (action === "submit") {

                req.session.active_order = order;
                req.session.order_name = order_name;

                const raw_mode = (req.body.order_mode || "").toUpperCase();

                const order_type = raw_mode === "ONLINE" ? "ONLINE" : "PARCEL";

                console.log("order type:", order_type);

                const address = req.body.delivery_address || null;

                const parcel_id = Math.floor(100 + Math.random() * 900);

                const query = `
                    INSERT INTO food_order
                    (name, order_amount, order_items, order_type, delivery_address)
                    VALUES ($1,$2,$3,$4,$5)
                `;

                const values = [
                    order_name,
                    order_total,
                    order_items_json,
                    order_type,
                    address
                ];

                const result = await db.insert_data(query, values);

                if (result) {

                    const orderResult = await db.fetch_data(
                        `SELECT order_id 
                        FROM food_order 
                        WHERE table_id=$1 
                        AND order_status!='DISTRIBUTED'
                        ORDER BY order_id DESC 
                        LIMIT 1`,
                        [parcel_id]
                    );

                    const order_id = orderResult[0]?.order_id;

                    req.session.js_alert = "Order Placed Successfully";

                    req.session.parcel_order = {
                        order_id: order_id,
                        customer: order_name,
                        items: order,
                        total: order_total,
                        status: "OPEN"
                    };
                    console.log("parcel order session set:", req.session.parcel_order);
                    const billtext = billPDF.generateBill(req.session.parcel_order, parcel_id, "PARCEL");
                    await billPDF.saveBillPDF(billtext, parcel_id);

                    return res.redirect("/parcel");
                }

            }

            else if (action === "pay") {

            const current = req.session.parcel_order;

            if (!current) {
                req.session.js_alert = "No active order";
                return res.redirect("/parcel");
            }

            const order_id = current.order_id;

            // mark order as paid
            await db.update_data(
                "UPDATE food_order SET order_status='PAID' WHERE order_id=$1",
                [order_id]
            );

            // clear parcel session
            delete req.session.parcel_order;

            req.session.js_alert = "Payment successful. Next customer ready.";

            return res.redirect("/parcel");
        }

        } catch (err) {

            console.error("Parcel order error:", err);

            res.status(500).send("Parcel order failed");

        }

    });

app.get("/distribution", async (req, res) => {

    const fetched_orders = await fetch_orders();

    for (const order of fetched_orders) {

        const items = order.items || {};

        for (const item of Object.values(items)) {
            if (!item.status) {
                item.status = "ORDERED";
            }
        }

    }

    console.log("fetched_orders :", fetched_orders);

    res.render("Distribution", {
        orders: fetched_orders
    });

});


app.get("/kitchen", async (req, res) => {

    const fetched_orders = await fetch_orders();

    console.log("fetched_orders:", fetched_orders);

    res.render("Kitchen", {
        orders: fetched_orders
    });

});

app.post("/kitchen/send-to-distribution", async (req, res) => {

    console.log("serve item called");

    const { order_id, item_name } = req.body;

    try {
        const query = "SELECT order_items FROM food_order WHERE order_id=$1";
        const result = await db.fetch_all_data(query, [order_id]);

        let items = result[0].order_items;

        if (typeof items === "string") {
            items = JSON.parse(items);
        }

        Object.values(items).forEach(item => {
            if (!item.status) {
                item.status = "ORDERED";
            }
        });

        if (items[item_name]) {
            items[item_name].status = "READY";
        }

        const all_done = Object.values(items).every(
            item => item.status === "READY" || item.status === "CANCELLED"
        );

        if (all_done) {

            await db.update_data(
                "UPDATE food_order SET order_items=$1, order_status='DISTRIBUTION' WHERE order_id=$2",
                [JSON.stringify(items), order_id]
            );

            console.log("database updated for the order_status");

        } else {

            await db.update_data(
                "UPDATE food_order SET order_items=$1 WHERE order_id=$2",
                [JSON.stringify(items), order_id]
            );

        }

        res.json({
            success: true,
            moved_to_distribution: all_done
        });

    } catch (err) {

        console.error("Error updating order:", err);

        res.status(500).json({
            success: false,
            error: "Failed to update order"
        });

    }

});


app.post("/distribution/serve-item", async (req, res) => {

    try {

        const { order_id, item_name } = req.body;

        // fetch order items
        const query = "SELECT order_items FROM food_order WHERE order_id = $1";
        const result = await db.fetch_all_data(query, [order_id]);

        let items = result[0].order_items;

        // PostgreSQL may already return JSON as object
        if (typeof items === "string") {
            items = JSON.parse(items);
        }

        // update item status
        if (items[item_name]) {
            items[item_name].status = "SERVED";
        }

        // update items in DB
        await db.update_data(
            "UPDATE food_order SET order_items = $1 WHERE order_id = $2",
            [JSON.stringify(items), order_id]
        );

        // check if all served or cancelled
        const allServed = Object.values(items).every(
            i => i.status === "SERVED" || i.status === "CANCELLED"
        );

        if (allServed) {
            await db.update_data(
                "UPDATE food_order SET order_status = 'DISTRIBUTED' WHERE order_id = $1",
                [order_id]
            );
        }

        res.json({ success: true });

    } catch (err) {

        console.error("Serve item error:", err);

        res.status(500).json({
            success: false,
            message: "Server error"
        });

    }

});

app.post("/order/cancel-item", async (req, res) => {

    try {

        console.log("food canceled");

        const { order_id, item_name } = req.body;

        console.log("order_id", order_id);
        console.log("item name", item_name);

        // fetch order items
        const query = "SELECT order_items FROM food_order WHERE order_id = $1";
        const result = await db.fetch_all_data(query, [order_id]);

        if (!result || result.length === 0) {
            return res.json({ success: false, msg: "Order not found" });
        }

        let items = result[0].order_items;

        // PostgreSQL may already return JSON as object
        if (typeof items === "string") {
            items = JSON.parse(items);
        }

        if (!items[item_name]) {
            return res.json({ success: false, msg: "Item not found" });
        }

        if (items[item_name].status === "SERVED") {
            return res.json({ success: false, msg: "Item already served" });
        }

        // mark cancelled
        items[item_name].status = "CANCELLED";

        // recalculate total
        const new_total = Object.values(items)
            .filter(i => i.status !== "CANCELLED")
            .reduce((sum, i) => sum + i.total, 0);

        await db.update_data(
            "UPDATE food_order SET order_items = $1, order_amount = $2 WHERE order_id = $3",
            [JSON.stringify(items), new_total, order_id]
        );

        console.log("order removed from db");

        // update session
        let orders_by_table = req.session.orders_by_table || {};

        console.log("orders by table:", orders_by_table);

        const table_id = String(req.body.table_id || req.body.table);

        console.log("table id", table_id);

        if (orders_by_table[table_id]) {

            const session_order = orders_by_table[table_id].order;

            if (session_order[item_name]) {
                session_order[item_name].status = "CANCELLED";

                req.session.orders_by_table = orders_by_table;

                console.log("item removed from session");
            }
        }

        res.json({ success: true });

    } catch (err) {

        console.error("Cancel item error:", err);

        res.status(500).json({
            success: false,
            msg: "Server error"
        });

    }

});


app.post("/table/set-available", async (req, res) => {

    try {

        const { table_id } = req.body;

        if (!table_id) {
            return res.json({
                success: false,
                msg: "Table ID missing"
            });
        }

        // update table in DB
        await db.update_data(
            "UPDATE dine_tables SET table_status = 'AVAILABLE', persons = 0 WHERE table_id = $1",
            [table_id]
        );

        // update session
        const current_table = req.session.current_table;

        if (current_table && current_table.table == table_id) {

            current_table.status = "AVAILABLE";

            req.session.current_table = current_table;
        }

        res.json({
            success: true,
            new_status: "AVAILABLE"
        });

    } catch (err) {

        console.error("Set table available error:", err);

        res.status(500).json({
            success: false,
            msg: "Server error"
        });

    }

});

app.get("/reset-system", (req, res) => {

    req.session.orders_by_table = {};
    req.session.current_table = null;
    req.session.parcel_order = null;
    req.session.order_id = null;

    res.send("Restaurant session reset");

});

app.route("/add_table")
    .get((req, res) => {
        res.render("add_table");
    })
    .post(async (req, res) => {
        // console.log("Received POST request to /add_table with body:", req.body);
        const { table_number, capacity } = req.body;    
        console.log("Received data:", { table_number, capacity });
        const query = "INSERT INTO dine_tables (table_id, capacity) VALUES ($1, $2)";
        const values = [table_number, capacity];
        const result = await db.insert_data(query, values);
        if (result) {
            res.status(200).json({ message: "Table added successfully" });
        } else {    
            res.status(500).json({ message: "Failed to add table" });
        }
    });


app.route("/add_food")
    .get((req, res) => {
        res.render("add_food");
    })
    .post(async (req, res) => {
        console.log("Received POST request to /add_food ");
        console.log(req.body);
        // const { food_item } = req.body;
        const query = "INSERT INTO food_items (food_item) VALUES ($1)";
        const values = [req.body];
        const result = await db.insert_data(query, values);
        if (result) {
            res.status(200).json({ message: "Food item added successfully" });
        } else {
            res.status(500).json({ message: "Failed to add food item" });
        }
    });


app.route("/food_items")
    .get(async (req, res) => {
        // Fetch food items from DB
        const query = "SELECT * FROM food_items ";
        const result = await db.fetch_all_data(query);
        console.log("Fetched food items:", result);
        res.render("food_items", { foods: result });
    })
    .post(async (req, res) => {
        const food = {
            id: req.body.id,
            img: req.body.img,
            name: req.body.name,
            price: req.body.price,
            veg: req.body.veg === "true",
            popular: req.body.popular === "true",
            category: req.body.category
        };
        // console.log("Received POST request to /food_items with data:", food);
        req.session.selected_food = food;

        res.redirect("/edit_food");

    });    

app.route("/edit_food")
    .get(async (req, res) => {
        console.log("Received GET request to /edit_food");
        const food = req.session.selected_food;
        console.log("Selected food from session:", food);
        res.render("edit_food",{ food });
    })
    .post(async (req, res) => {
        console.log("Received POST request to /add_food ");
        const food_item = {
            // id: req.body.id,
            img: req.body.img,
            name: req.body.name,
            price: req.body.price,
            veg: req.body.veg === true || req.body.veg === "true",
            popular: req.body.popular === true || req.body.popular === "true",
            category: req.body.category
        };
         const id = parseInt(req.body.id);
        console.log("Food data to update:", food_item, id);
        const query = "UPDATE food_items SET food_item = $1 WHERE id = $2";
        const values = [JSON.stringify(food_item),  id];
        const result = await db.update_data(query, values);
        if (result) {
            return res.json({ success: true, message: "Food item updated successfully" });
        } else {
            return res.status(500).json({ success: false, message: "Failed to update food item" });
        }
    });    



app.post("/order/get-bill-preview", async (req,res)=>{

    const table_id = req.body.table_id;
    const orders_by_table = req.session.orders_by_table || {};

    const current = orders_by_table[table_id];

    if(!current){
        return res.json({
            success:false,
            msg:"No active order"
        });
    }

    const billtext = billPDF.generateBill(current, table_id, "TABLE");

    res.json({
        success:true,
        bill: billtext
    });

});


app.post("/parcel/get-bill-preview", (req, res) => {

    const parcel = req.session.parcel_order;

    if (!parcel) {
        return res.json({
            success:false,
            msg:"No parcel order found"
        });
    }

    const billtext = billPDF.generateBill(parcel, parcel.order_id, "PARCEL");

    res.json({
        success:true,
        bill: billtext
    });

});

app.post("/order/print-bill", async (req,res)=>{

    const table_id = req.body.table_id;
    const orders_by_table = req.session.orders_by_table || {};

    const current = orders_by_table[table_id];

    if(!current){
        return res.json({
            success:false,
            msg:"No order found"
        });
    }

    try{

        const billtext = billPDF.generateBill(current, table_id, "TABLE");

        await billPDF.saveBillPDF(billtext, table_id);

        res.json({
            success:true
        });

    }
    catch(err){

        console.log(err);

        res.json({
            success:false,
            msg:"PDF generation failed"
        });

    }

});

app.post("/parcel/print-bill", async (req,res)=>{

    const parcel = req.session.parcel_order;

    if(!parcel){
        return res.json({
            success:false,
            msg:"No parcel order found"
        });
    }

    try{

        const billtext = billPDF.generateBill(parcel, parcel.order_id, "PARCEL");

        await billPDF.saveBillPDF(billtext, parcel.order_id);

        res.json({
            success:true
        });

    }
    catch(err){

        console.log(err);

        res.json({
            success:false,
            msg:"PDF generation failed"
        });

    }

});

async function fetch_table_status() {

    const query = "SELECT table_id, table_status, persons, capacity FROM dine_tables order by table_id";

    const result = await db.fetchdatawithoutvalue(query); 
    // result is already result.rows

    const tables = result.map(r => ({
        id: r.table_id,
        state: r.table_status.toLowerCase(),
        persons: r.persons,
        capacity: r.capacity
    }));

    console.log("Fetched table status:", tables);
    return tables;
}


async function insert_data(tableCount) {

    console.log(tableCount);

    for (let table_id = 1; table_id <= tableCount; table_id++) {

        const query = `
            INSERT INTO dine_tables (table_id)
            VALUES ($1)
        `;

        const values = [table_id];

        await db.insert_data(query, values);
    }

}

async function fetch_orders() {

    const query = "SELECT * FROM food_order WHERE order_status NOT IN ('DISTRIBUTED', 'PAID') ";

    const result = await db.fetchdatawithoutvalue(query);

    const orders = [];

    for (const order of result) {

        orders.push({
            order_id: order.order_id,
            table_id: order.table_id,
            name: order.name,
            amount: order.order_amount,
            items: typeof order.order_items === "string"
                ? JSON.parse(order.order_items)
                : order.order_items,
            status: order.order_status,
            order_type: order.order_type,
            address: order.delivery_address
        });

    }

    return orders;
}



async function fetch_order_id(table_id) {

    const table_no = Number(table_id);

    const query = `
        SELECT order_id
        FROM food_order
        WHERE table_id = $1
        AND order_status != 'DISTRIBUTED'
        ORDER BY order_id DESC
        LIMIT 1
    `;

    const values = [table_no];

    const result = await db.fetch_data(query, values);

    console.log("order id");
    console.log(result[0]);

    if (result && result.length > 0) {
        return result[0].order_id;
    } else {
        return null;
    }
}

async function can_pay_order(order_id) {

    const query = `
        SELECT order_status
        FROM food_order
        WHERE order_id = $1
    `;

    const result = await db.fetch_all_data(query, [order_id]);

    return result && result.length > 0 && result[0].order_status === "DISTRIBUTED";
}

async function fetch_food_items() {
    const query = "SELECT food_item FROM food_items ";
        const result = await db.fetch_all_data(query);

        const foods = result.map(row => row.food_item);
        return foods;   
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend running at http://0.0.0.0:${PORT}`);
});

