import { Router, type IRouter } from "express";
import {
  downloadProfilesCsv,
  enrichProfiles,
  getProfileDetails,
  listCompanyCategories,
  listLocations,
  listProfiles,
  listTopCompanyProfiles,
  proxyProfileImage,
  updateGender,
} from "../controllers/searchController.js";

const router: IRouter = Router();

router.post("/profiles", listProfiles);
router.post("/profiles/top-companies", listTopCompanyProfiles);
router.post("/profiles/gender", updateGender);
router.post("/profiles/enrich", enrichProfiles);
router.post("/profiles/download", downloadProfilesCsv);
router.get("/profile/:profileId", getProfileDetails);
router.get("/profile-image", proxyProfileImage);
router.get("/locations", listLocations);
router.get("/company-categories", listCompanyCategories);

export default router;
