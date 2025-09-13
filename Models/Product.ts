import mongoose, { Schema } from "mongoose";
import { IProduct } from "../types";

const productSchema = new Schema<IProduct>({
    authorId: {
        type: Schema.ObjectId,
        ref: 'User',
        required: true
    },
    name: {
        type: String,
        required: true,
        maxlength: [100, "product name is too long"]
    },
    price: {
        type: Number,
        required: true,
    },
    images: [{
        type: String,
        required: true,
    }],
    quantity: {
        type: Number,
        default: 1,
        sparse: true
    },
    license: {
        type: String,
        sparse: true
    },
    exp: {
        type: Date,
        sparse: true
    },
    description: {
        type: String,
        required: true,
    },
    isDeleted: {
        type: Boolean,
    }
}, { timestamps: true })

const Product = mongoose.model("Product", productSchema)
export default Product;

productSchema.index({name: 1, images: 1 })