import { Router } from "express";
import WalletController from "../controllers/wallet.controller.js";
import WalletService from "../../application/use-cases/wallet.service.js";
import WalletMySQLRepository from "../../infrastructure/database/mysql/wallet.mysql.repository.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = Router();
const controller = new WalletController(new WalletService(new WalletMySQLRepository()));
router.use(authMiddleware);
router.post("/", controller.create);
router.get("/", controller.list);
router.delete("/:id", controller.delete);
export default router;
