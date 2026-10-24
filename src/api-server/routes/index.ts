import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import storageRouter from "./storage";
import quotationDocumentsRouter from "./quotation-documents";
import flaskIntegrationRouter from "./flask-integration";
import procurementRouter from "./procurement";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(storageRouter);
router.use(quotationDocumentsRouter);
router.use(flaskIntegrationRouter);
router.use(procurementRouter);

export default router;
