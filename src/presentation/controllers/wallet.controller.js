export default class WalletController {
    constructor(service) { this.service = service; }
    create = async (req, res) => { try { res.status(201).json(await this.service.create(req.body, req.user.id)); } catch (e) { res.status(400).json({ error: e.message }); } };
    list = async (req, res) => { res.status(200).json(await this.service.list(req.user.id)); };
    delete = async (req, res) => { try { res.status(200).json(await this.service.delete(req.params.id, req.user.id)); } catch (e) { res.status(e.message.startsWith("Forbidden") ? 403 : e.message.includes("cannot be deleted") ? 409 : 404).json({ error: e.message }); } };
}
