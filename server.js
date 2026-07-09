const crypto = require("crypto");
const express = require("express");
const Razorpay = require("razorpay");
const cors = require("cors");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Create Order
app.post("/create-order", async (req, res) => {
    try {
        const { amount } = req.body;

        const options = {
            amount: Math.round(Number(amount) * 100),
            currency: "INR",
            receipt: "receipt_" + Date.now(),
            payment_capture: 1,
        };

        const order = await razorpay.orders.create(options);

        res.json(order);
    } catch (err) {
        console.log(err);
        res.status(500).json({
            success: false,
            error: err.message,
        });
    }
});
// Verify Payment
app.post("/verify-payment", async (req, res) => {
    try {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
        } = req.body;

        const body =
            razorpay_order_id + "|" + razorpay_payment_id;

        const expectedSignature = crypto
            .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
            .update(body.toString())
            .digest("hex");

        if (expectedSignature === razorpay_signature) {
            return res.json({
                success: true,
            });
        }

        return res.status(400).json({
            success: false,
            message: "Invalid Signature",
        });
    } catch (err) {
        console.log(err);

        res.status(500).json({
            success: false,
            error: err.message,
        });
    }
});

app.listen(process.env.PORT || 5000, () => {
    console.log("Server Running on Port", process.env.PORT || 5000);
});