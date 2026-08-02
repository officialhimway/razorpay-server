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
            course_id,
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
        // ===== REQUEST VALIDATION =====

        if (!auth_id) {
            return res.status(400).json({
                success: false,
                message: "auth_id is required",
            });
        }

        if (purchase_type === "mock" && !test_id) {
            return res.status(400).json({
                success: false,
                message: "test_id is required",
            });
        }

        if (purchase_type === "mock_bundle" && !folder_id) {
            return res.status(400).json({
                success: false,
                message: "folder_id is required",
            });
        }

        if (purchase_type === "live" && !test_id) {
            return res.status(400).json({
                success: false,
                message: "test_id is required",
            });
        }

        if (purchase_type === "course" && !course_id) {
            return res.status(400).json({
                success: false,
                message: "course_id is required",
            });
        }

        if (purchase_type === "notes" && !folder_id && !note_id) {
            return res.status(400).json({
                success: false,
                message: "folder_id or note_id is required",
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
        // ===== MOCK BUNDLE PURCHASE =====
        if (purchase_type === "mock_bundle") {

            const { data: tests, error: fetchError } = await supabase
                .from("mock_tests")
                .select("id")
                .eq("folder_id", folder_id)
                .eq("is_paid", true);

            if (fetchError) {
                return res.status(500).json({
                    success: false,
                    message: fetchError.message,
                });
            }

            if (tests?.length) {

                const rows = tests.map((t) => ({
                    auth_id,
                    test_id: t.id,
                    payment_id: razorpay_payment_id,
                }));

                const { error } = await supabase
                    .from("purchases")
                    .upsert(rows, {
                        onConflict: "auth_id,test_id",
                    });

                if (error) {
                    console.log(error);

                    return res.status(500).json({
                        success: false,
                        message: error.message,
                    });
                }
            }
        }
        // ===== LIVE TEST PURCHASE =====
        if (purchase_type === "live") {

            const { error } = await supabase
                .from("live_test_enrollments")
                .upsert(
                    {
                        user_id: auth_id,
                        test_id,
                        payment_id: razorpay_payment_id,
                    },
                    {
                        onConflict: "user_id,test_id",
                    }
                );

            if (error) {
                console.log("Live Purchase Error:", error);

                return res.status(500).json({
                    success: false,
                    message: error.message,
                });
            }
        }
        // ===== COURSE PURCHASE =====
        if (purchase_type === "course") {

            const { data: course, error: courseError } = await supabase
                .from("courses")
                .select("final_price, valid_till")
                .eq("id", course_id)
                .single();

            if (courseError || !course) {
                return res.status(404).json({
                    success: false,
                    message: "Course not found",
                });
            }

            const { error: paymentError } = await supabase
                .from("course_payments")
                .insert({
                    auth_id,
                    course_id,
                    razorpay_payment_id: razorpay_payment_id,
                    amount: course.final_price,
                    currency: "INR",
                    status: "success",
                });

            if (paymentError) {
                return res.status(500).json({
                    success: false,
                    message: paymentError.message,
                });
            }

            const { error: enrollError } = await supabase
                .from("course_enrollments")
                .upsert(
                    {
                        auth_id,
                        course_id,
                        access_type: "buy",
                        access_valid_till: course.valid_till,
                        is_active: true,
                    },
                    {
                        onConflict: "auth_id,course_id",
                    }
                );

            if (enrollError) {
                return res.status(500).json({
                    success: false,
                    message: enrollError.message,
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