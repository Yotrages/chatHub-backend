import { Request, Response } from "express";
import { ERROR_MESSAGES, HTTP_STATUS } from "../../utils/constant";
import Product from "../../Models/Product";
import { UserSettings } from "../../Models/userSettings";

export class ProductController {
  static async getProducts(req: Request, res: Response) {
    const limit = parseInt(req.query.limit as string) || 15;
    const page = parseInt(req.query.page as string) || 1;
    const skip = (page - 1) * limit;

    try {
      const products = await Product.find()
        .skip(skip)
        .populate("authorId", "username avatar");
      const totalProducts = await Product.countDocuments();
      const totalPages = Math.ceil(totalProducts / limit);
      res.status(HTTP_STATUS.OK).json({
        success: true,
        products,
        pagination: {
          currentPage: page,
          totalPages,
          totalProducts,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      });
    } catch (error) {
      console.log(error);
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json({ error: ERROR_MESSAGES.SERVER_ERROR });
    }
  }

  static async createProduct(req: Request, res: Response) {
    try {
      const { name, description, exp, price, quantity, license } = req.body;
      const images = req.files as Express.Multer.File[];
      const userId = req.user.userId;
      if (!userId) {
        res
          .status(HTTP_STATUS.UNAUTHORIZED)
          .json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      return;
    }
      const userSettings = await UserSettings.findOne({ userId });
      if (userSettings?.account.isDeactivated) {
        res
          .status(HTTP_STATUS.FORBIDDEN)
          .json({ error: "Cannot create post: Account is deactivated" });
        return;
      }

      if (!name || !description || !price) {
        res
          .status(HTTP_STATUS.FORBIDDEN)
          .json({ error: "name, description and price field are required" });
        return;
      }
      if (!images || images.length === 0) {
        res
          .status(HTTP_STATUS.FORBIDDEN)
          .json({ error: "Images field is required" });
        return;
      }

      const newProduct = new Product({
        name: name,
        description: description,
        images: images.map((image) => image.path),
        price: price,
        exp: exp ?? undefined,
        license: license ?? undefined,
        quantity: quantity,
      });

      await newProduct.save();
      res.status(HTTP_STATUS.CREATED).json({
        success: true,
        message: "Product created successfully",
        product: newProduct,
      });
    } catch (error) {
      console.log(error);
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json({ error: ERROR_MESSAGES.SERVER_ERROR });
    }
  }
}
