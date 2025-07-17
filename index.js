// ✅ Updated Backend with Smart Merge Logic for Shoe POS System
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

    // ✅ FULL BACKEND FIX WITH MULTIPLE BARCODE GENERATION

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

          // ✅ Generate individual barcodes for each pair
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

    // ✅ GET: Grouped Stock
    app.get("/api/shoes", async (req, res) => {
      try {
        const groupedShoes = await shoesCollection
          .aggregate([
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
                createdAt: { $max: "$createdAt" },
              },
            },
            {
              $project: {
                _id: 0,
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
            { $sort: { createdAt: -1 } },
          ])
          .toArray();

        res.json(groupedShoes);
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Error fetching grouped stock data" });
      }
    });
    app.get("/api/shoes/barcode/:code", async (req, res) => {
      const code = req.params.code;
      const baseBarcode = code.split("-").slice(0, 4).join("-"); // safely extract up to size

      try {
        const result = await db
          .collection("shoes")
          .findOne({ barcode: baseBarcode });

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
    app.get("/api/sales/:id", async (req, res) => {
      try {
        const saleId = req.params.id;
        console.log(saleId);
        if (!ObjectId.isValid(saleId)) {
          return res.status(400).json({ message: "Invalid sale ID" });
        }

        // Find sale by _id
        const sale = await db
          .collection("sales")
          .findOne({ _id: new ObjectId(saleId) });

        if (!sale) {
          return res.status(404).json({ message: "Sale not found" });
        }

        res.json(sale);
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to fetch sale data" });
      }
    });
    // POST: Sell shoe
    app.post("/api/sell", async (req, res) => {
      try {
        const { cart } = req.body;

        if (!Array.isArray(cart) || cart.length === 0) {
          return res.status(400).json({ message: "Cart is empty" });
        }

        // Check stock and prepare update operations and sale items
        const bulkUpdate = [];
        const saleItems = [];

        for (const item of cart) {
          const { barcode, qty, price, discount = 0 } = item;

          if (!barcode || !qty || !price) {
            return res.status(400).json({ message: "Invalid cart item data" });
          }

          const existing = await shoesCollection.findOne({ barcode });
          if (!existing || existing.quantity < qty) {
            return res.status(400).json({
              message: `Insufficient stock or product not found for barcode: ${barcode}`,
            });
          }

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

        // Bulk update stock
        if (bulkUpdate.length > 0) {
          await shoesCollection.bulkWrite(bulkUpdate);
        }

        // Insert one sale document for the whole transaction
        const saleDoc = {
          items: saleItems,
          soldAt: new Date(),
        };

        const result = await db.collection("sales").insertOne(saleDoc);

        res.status(200).json({
          message: "Sale completed successfully",
          saleId: result.insertedId, // send back the sale document id
        });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Sale failed" });
      }
    });

    app.get("/api/sales", async (req, res) => {
      try {
        const sales = await db
          .collection("sales")
          .find()
          .sort({ soldAt: -1 })
          .toArray();

        res.json(sales);
      } catch (err) {
        console.error("Error fetching sales:", err);
        res.status(500).json({ message: "Failed to fetch sales" });
      }
    });
    // Update sale item inside a sale document
    app.get("/api/sales/:id", async (req, res) => {
      const { id } = req.params;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid sale ID" });
      }

      try {
        const sale = await db
          .collection("sales")
          .findOne({ _id: new ObjectId(id) });

        if (!sale) {
          return res.status(404).json({ message: "Sale not found" });
        }

        res.json(sale);
      } catch (error) {
        console.error("Error fetching sale:", error);
        res.status(500).json({ message: "Failed to fetch sale" });
      }
    });

    // Sale এর item আপডেট করার জন্য PATCH route
    app.patch("/api/sales/:saleId/item/:itemIndex", async (req, res) => {
      const { saleId, itemIndex } = req.params;
      const { quantity, sellPrice, discount } = req.body;

      if (!ObjectId.isValid(saleId)) {
        return res.status(400).json({ message: "Invalid sale ID" });
      }

      const idx = parseInt(itemIndex);
      if (isNaN(idx)) {
        return res.status(400).json({ message: "Invalid item index" });
      }

      try {
        const sale = await db
          .collection("sales")
          .findOne({ _id: new ObjectId(saleId) });

        if (!sale) return res.status(404).json({ message: "Sale not found" });

        if (!sale.items || !sale.items[idx]) {
          return res.status(404).json({ message: "Sale item not found" });
        }

        // আপডেটেড আইটেম
        const updatedItem = {
          ...sale.items[idx],
          quantity: quantity ?? sale.items[idx].quantity,
          sellPrice: sellPrice ?? sale.items[idx].sellPrice,
          discount: discount ?? sale.items[idx].discount,
        };

        updatedItem.totalAmount =
          updatedItem.quantity * updatedItem.sellPrice - updatedItem.discount;

        // আইটেম পরিবর্তন
        sale.items[idx] = updatedItem;

        // ডাটাবেজে আপডেট
        await db
          .collection("sales")
          .updateOne(
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
      console.log(`✅ Server is running on port ${port}`);
    });

    await client.db("admin").command({ ping: 1 });
    console.log("✅ Successfully connected to MongoDB!");
  } catch (error) {
    console.error("❌ Failed to connect to MongoDB", error);
  }
}

run().catch(console.dir);
