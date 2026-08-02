const { createClient } = require("@supabase/supabase-js");
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
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);
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

            auth_id,
            purchase_type,

            folder_id,
            note_id,
            test_id,
        } = req.body;

        const body = razorpay_order_id + "|" + razorpay_payment_id;

        const expectedSignature = crypto
            .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
            .update(body)
            .digest("hex");

        if (expectedSignature !== razorpay_signature) {
            return res.status(400).json({
                success: false,
                message: "Invalid Signature",
            });
        }

        // ===== NOTES PURCHASE =====
        if (purchase_type === "notes") {
            const purchaseData = {
                auth_id,
                payment_id: razorpay_payment_id,
            };

            if (folder_id) purchaseData.folder_id = folder_id;
            if (note_id) purchaseData.note_id = note_id;

            const { error } = await supabase
                .from("notes_purchases")
                .upsert(purchaseData, {
                    onConflict: folder_id
                        ? "auth_id,folder_id"
                        : "auth_id,note_id",
                });

            if (error) {
                console.log("Supabase Error:", error);

                return res.status(500).json({
                    success: false,
                    message: error.message,
                });
            }
        }
// ===== MOCK TEST PURCHASE =====
if (purchase_type === "mock") {

    const { error } = await supabase
        .from("purchases")
        .upsert(
            {
                auth_id,
                test_id,
                payment_id: razorpay_payment_id,
            },
            {
                onConflict: "auth_id,test_id",
            }
        );

    if (error) {
        console.log("Mock Purchase Error:", error);

        return res.status(500).json({
            success: false,
            message: error.message,
        });
    }
}
        return res.json({
            success: true,
        });

    } catch (err) {
        console.log(err);

        return res.status(500).json({
            success: false,
            error: err.message,
        });
    }
});

app.listen(process.env.PORT || 5000, () => {
    console.log("Server Running on Port", process.env.PORT || 5000);
});