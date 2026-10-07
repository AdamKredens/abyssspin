import { handleApiRequest } from "../lib/backend.js";

export default async function handler(req, res) {
  await handleApiRequest(req, res);
}
