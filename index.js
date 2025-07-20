const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.nbenc92.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    const db = client.db("Shoes-shop-pos");
    const shoesCollection = db.collection("shoes");
    const salesCollection = db.collection("sales"); // <==== declared here
    // add user
    app.post("/api/users", async (req, res) => {
      const { name, email, photo, role } = req.body;

      try {
        const existingUser = await db.collection("users").findOne({ email });
        if (existingUser) {
          return res.status(200).json({ message: "User already exists" });
        }

        const result = await db.collection("users").insertOne({
          name,
          email,
          photo,
          role,
          createdAt: new Date(),
        });

        res
          .status(201)
          .json({ message: "User saved", insertedId: result.insertedId });
      } catch (error) {
        res.status(500).json({ error: "Something went wrong" });
      }
    });

    app.listen(port, () => {
      console.log(`🚀 Server running on http://localhost:${port}`);
    });
    // POST: Add Shoes
    app.post("/api/shoes/add", async (req, res) => {
      try {
        const {
          shoeName,
          brand,
          articleNumber,
          color,
          pricePerPair,
          quantitiesPerSize,
        } = req.body;

        let insertedCount = 0;
        let updatedCount = 0;
        const addedShoes = [];

        for (const [size, qty] of Object.entries(quantitiesPerSize)) {
          const quantity = Number(qty);
          if (!quantity || isNaN(quantity) || quantity <= 0) continue;

          const sizeNum = Number(size);
          const price = Number(pricePerPair);
          const genericBarcode = `${brand}-${articleNumber || "NA"}-${sizeNum}`;

          const existing = await shoesCollection.findOne({
            shoeName,
            brand,
            articleNumber,
            color,
            size: sizeNum,
            pricePerPair: price,
          });

          if (existing) {
            await shoesCollection.updateOne(
              { _id: existing._id },
              { $inc: { quantity } }
            );
            updatedCount++;
          } else {
            await shoesCollection.insertOne({
              shoeName,
              brand,
              articleNumber,
              color,
              size: sizeNum,
              quantity,
              pricePerPair: price,
              barcode: genericBarcode,
              createdAt: new Date(),
            });
            insertedCount++;
          }

          for (let i = 0; i < quantity; i++) {
            const timestamp = Date.now();
            addedShoes.push({
              brand,
              articleNumber,
              size: sizeNum,
              barcode: `${brand}-${
                articleNumber || "NA"
              }-${sizeNum}-${timestamp}-${i}`,
            });
          }
        }

        res.status(201).json({
          message: "Shoes added/updated successfully",
          insertedCount,
          updatedCount,
          addedShoes,
        });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
      }
    });

    // GET: Grouped Shoes stock
    app.get("/api/shoes", async (req, res) => {
      try {
        const groupedShoes = await shoesCollection
          .aggregate([
            { $sort: { createdAt: -1 } }, // Step 1: Sort by createdAt descending
            {
              $group: {
                _id: {
                  shoeName: "$shoeName",
                  brand: "$brand",
                  articleNumber: "$articleNumber",
                  color: "$color",
                  size: "$size",
                  pricePerPair: "$pricePerPair",
                },
                quantity: { $sum: "$quantity" },
                createdAt: { $first: "$createdAt" }, // Save latest createdAt
                anyId: { $first: "$_id" },
              },
            },
            {
              $project: {
                _id: "$anyId",
                shoeName: "$_id.shoeName",
                brand: "$_id.brand",
                articleNumber: "$_id.articleNumber",
                color: "$_id.color",
                size: "$_id.size",
                pricePerPair: "$_id.pricePerPair",
                quantity: 1,
                createdAt: 1,
              },
            },
            { $sort: { createdAt: -1 } }, // ✅ Step 2: Final sort after grouping
          ])
          .toArray();

        res.json(groupedShoes);
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Error fetching grouped stock" });
      }
    });
    app.get("/api/shoes/:id", async (req, res) => {
      const { id } = req.params;
      console.log(id);
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid shoe ID" });
      }

      try {
        const shoe = await shoesCollection.findOne({ _id: new ObjectId(id) });
        if (!shoe) {
          return res.status(404).json({ message: "Shoe not found" });
        }
        res.json(shoe);
      } catch (err) {
        console.error("Failed to fetch shoe:", err);
        res.status(500).json({ message: "Server error" });
      }
    });
    app.put("/api/shoes/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const update = req.body;

        const result = await shoesCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: update }
        );

        if (result.modifiedCount === 0)
          return res.status(400).send({ error: "No shoe updated" });

        res.send({ message: "Shoe updated successfully" });
      } catch (error) {
        res.status(500).send({ error: "Update failed" });
      }
    });

    // GET by barcode
    app.get("/api/shoes/barcode/:code", async (req, res) => {
      const baseBarcode = req.params.code.split("-").slice(0, 4).join("-");
      try {
        const result = await shoesCollection.findOne({ barcode: baseBarcode });
        if (!result) return res.status(404).json({ message: "Not found" });
        res.json({
          shoeName: result.shoeName,
          color: result.color,
          size: result.size,
          pricePerPair: result.pricePerPair,
          brand: result.brand,
          articleNumber: result.articleNumber,
          stock: result.quantity,
          barcode: result.barcode,
        });
      } catch (err) {
        res.status(500).json({ message: "Server error" });
      }
    });

    // POST: Sell shoes - Create sale + update stock
    app.post("/api/sell", async (req, res) => {
      try {
        const { cart } = req.body;
        if (!Array.isArray(cart) || cart.length === 0)
          return res.status(400).json({ message: "Cart is empty" });

        const bulkUpdate = [];
        const saleItems = [];

        for (const item of cart) {
          const { barcode, qty, price, discount = 0 } = item;
          if (!barcode || !qty || !price)
            return res.status(400).json({ message: "Invalid cart item data" });

          const existing = await shoesCollection.findOne({ barcode });

          if (!existing || existing.quantity < qty)
            return res.status(400).json({
              message: `Insufficient stock or product not found for barcode: ${barcode}`,
            });

          bulkUpdate.push({
            updateOne: {
              filter: { barcode },
              update: { $inc: { quantity: -qty } },
            },
          });

          const profit = (price - existing.pricePerPair) * qty;

          saleItems.push({
            barcode,
            quantity: qty,
            sellPrice: price,
            discount,
            profit,
            totalAmount: price * qty - discount,
            shoeInfo: {
              shoeName: existing.shoeName,
              brand: existing.brand,
              articleNumber: existing.articleNumber,
              size: existing.size,
              color: existing.color,
            },
          });
        }

        if (bulkUpdate.length > 0) await shoesCollection.bulkWrite(bulkUpdate);

        // Save sale with BD timezone date
        const bdTime = new Date(
          new Date().toLocaleString("en-US", { timeZone: "Asia/Dhaka" })
        );

        const saleDoc = { items: saleItems, soldAt: bdTime };
        const result = await salesCollection.insertOne(saleDoc);

        res.json({ message: "Sale completed", saleId: result.insertedId });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Sale failed" });
      }
    });

    // Fetch sales with optional date filtering
    app.get("/api/sales", async (req, res) => {
      try {
        const { from, to } = req.query;
        const filter = {};

        if (from && to) {
          const fromDate = new Date(from + "T00:00:00+06:00");
          const toDate = new Date(to + "T23:59:59+06:00");
          if (!isNaN(fromDate) && !isNaN(toDate)) {
            filter.soldAt = { $gte: fromDate, $lte: toDate };
          }
        }

        const sales = await salesCollection
          .find(filter)
          .sort({ soldAt: -1 })
          .toArray();

        // Calculate totalAmount from all sales items
        const totalAmount = sales.reduce((acc, sale) => {
          const saleTotal = sale.items.reduce(
            (sum, item) => sum + (item.totalAmount || 0),
            0
          );
          return acc + saleTotal;
        }, 0);

        res.json({ sales, totalAmount });
      } catch (err) {
        console.error("❌ Failed to fetch sales:", err);
        res.status(500).json({ message: "Failed to fetch sales" });
      }
    });

    // GET sale by ID
    app.get("/api/sales/:id", async (req, res) => {
      const { id } = req.params;
      if (!ObjectId.isValid(id))
        return res.status(400).json({ message: "Invalid sale ID" });

      try {
        const sale = await salesCollection.findOne({ _id: new ObjectId(id) });
        if (!sale) return res.status(404).json({ message: "Sale not found" });
        res.json(sale);
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to fetch sale" });
      }
    });

    // PUT update sale items (replace all items)
    app.put("/api/sales/:saleId", async (req, res) => {
      const { saleId } = req.params;
      const { items } = req.body;
      if (!ObjectId.isValid(saleId))
        return res.status(400).json({ message: "Invalid sale ID" });

      if (!Array.isArray(items) || items.length === 0)
        return res.status(400).json({ message: "Items array required" });

      try {
        const updatedItems = items.map((item) => {
          const quantity = Number(item.quantity || 0);
          const sellPrice = Number(item.sellPrice || 0);
          const discount = Number(item.discount || 0);
          return {
            ...item,
            quantity,
            sellPrice,
            discount,
            totalAmount: quantity * sellPrice - discount,
          };
        });

        const result = await salesCollection.updateOne(
          { _id: new ObjectId(saleId) },
          { $set: { items: updatedItems } }
        );

        if (result.modifiedCount === 0)
          return res.status(404).json({ message: "Sale not updated" });

        res.json({ message: "Sale updated successfully", updatedItems });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to update sale" });
      }
    });

    // PATCH update sale item (specific item index)
    app.patch("/api/sales/:saleId/item/:itemIndex", async (req, res) => {
      const { saleId, itemIndex } = req.params;
      const { quantity, sellPrice, discount } = req.body;

      if (!ObjectId.isValid(saleId))
        return res.status(400).json({ message: "Invalid sale ID" });

      const idx = parseInt(itemIndex);
      if (isNaN(idx))
        return res.status(400).json({ message: "Invalid item index" });

      try {
        const sale = await salesCollection.findOne({
          _id: new ObjectId(saleId),
        });
        if (!sale) return res.status(404).json({ message: "Sale not found" });

        if (!sale.items || !sale.items[idx])
          return res.status(404).json({ message: "Sale item not found" });

        const updatedItem = {
          ...sale.items[idx],
          quantity: quantity ?? sale.items[idx].quantity,
          sellPrice: sellPrice ?? sale.items[idx].sellPrice,
          discount: discount ?? sale.items[idx].discount,
        };

        updatedItem.totalAmount =
          updatedItem.quantity * updatedItem.sellPrice - updatedItem.discount;

        sale.items[idx] = updatedItem;

        await salesCollection.updateOne(
          { _id: new ObjectId(saleId) },
          { $set: { items: sale.items } }
        );

        res.json({ message: "Sale item updated successfully", updatedItem });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to update sale item" });
      }
    });

    app.get("/", (req, res) => {
      res.send("Shoe POS Backend is running 🚀");
    });

    app.listen(port, () => {
      console.log(`✅ Server running on port ${port}`);
    });

    await client.db("admin").command({ ping: 1 });
    console.log("✅ Successfully connected to MongoDB!");
  } catch (err) {
    console.error("❌ Failed to connect to MongoDB", err);
  }
}

run().catch(console.dir);
