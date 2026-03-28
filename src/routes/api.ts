import { Router, type IRouter } from "express";
import {
  downloadProfilesCsv,
  getProfileDetails,
  listCompanyCategories,
  listLocations,
  listProfiles,
  proxyProfileImage,
} from "../controllers/searchController.js";

const router: IRouter = Router();

router.post("/profiles", listProfiles);
router.post("/profiles/download", downloadProfilesCsv);
router.get("/profile/:profileId", getProfileDetails);
router.get("/profile-image", proxyProfileImage);
router.get("/locations", listLocations);
router.get("/company-categories", listCompanyCategories);

export default router;
