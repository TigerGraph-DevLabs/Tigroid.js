class TigroidException {
    constructor(message, code) {
        this.message = message;
        this.code    = code;
    }
}

class HttpError {
    constructor(message, code) {
        this.message = message;
        this.code    = code;
    }
}

class Tigroid {

    // Private functions ========================================================

    _errorCheck(res) {
        if ("error" in res && res["error"]) {
            throw new TigroidException(res["message"], ("code" in res) ? res["code"] : null);
        }
    }

    _req({method = "GET", url = "", authMode= "token", headers = null, data = null, resKey = "results", skipCheck = false, params = null}) {

        let _auth = null;
/*
        if (authMode == "pwd") {
            _auth = {username, password};
        }
*/
        let _headers = {};
        /*
        if (authMode === "token") {
            _headers = this.authHeader;
        }
        */
        if (headers) {
            _headers = Object.assign(_headers, headers)
        }
        if (this.debug && _headers) {
            console.log(_headers);
        }

        let _data;
        if (method === "POST") {
            _data = data
        } else {
            _data = null
        }

        let _params = ""
        if (params) {
            if (typeof params === "string") {
                _params = params;
            } else if (typeof params === "object") {
                let isFirst = true;
                for (let p in params) {
                    if (! isFirst) {
                        _params += "&";
                    }
                    _params += p + "=" + params[p];
                    isFirst = false;
                }
            }
            _params = "?" + encodeURI(_params);
        }

        if (this.debug) {
            console.log(method + " " + url + (_params ? _params : "") + (data ? " => " + data : ""));
        }

        this.xhr.open(method, url + (_params ? _params : ""), false); //, this.username, this.password);
/*
        if (_headers) {
            if (this.debug) {
                console.log(_headers);
            }
            for (let h in _headers) {
                this.xhr.setRequestHeader(h, _headers[h]);
            }
        }
*/
        this.xhr.send(_data);
        let res = JSON.parse(this.xhr.responseText);

        if (this.debug) {
            console.log(this.xhr.responseURL);
        }

        if (this.xhr.status !== 200) {
            throw new HttpError(this.xhr.statusText, this.xhr.status);
        }

        if (! skipCheck) {
            this._errorCheck(res)
        }

        if (! resKey) {
            if (this.debug) {
                console.log(res);
            }
            return res;
        }
        if (this.debug) {
            console.log(res[resKey]);
        }
        return res[resKey];
    }

    _get({url, authMode = "token", headers = null, resKey = "results", skipCheck = false, params = null}) {
        return this._req({method: "GET", url: url, authMode: authMode, headers: headers, data: null, resKey: resKey, skipCheck: skipCheck, params: params});
    }

    _post({url, authMode= "token", headers = null, data = null, resKey = "results", skipCheck = false, params = null}) {
        return this._req({method: "POST", url: url, authMode: authMode, headers: headers, data: data, resKey: resKey, skipCheck: skipCheck, params: params})
    }

    _delete({url, authMode}) {
        return this._req({method: "DELETE", url: url, authMode: authMode});
    }

    _upsertAttrs(attributes) {
        if (this.debug) {
            console.log(attributes);
        }
        if (typeof attributes !== "object") {
            return {};
        }
        let vals = {};
        for (let attr in attributes) {
            let val = attributes[attr];
            if (Array.isArray(val)) {
                vals[attr] = {value: val[0], op: val[1]};
            } else {
                vals[attr] = {value: val}
            }
        }
        if (this.debug) {
            console.log(vals);
        }
        return vals;
    }

    // Schema related functions =================================================

    _getUDTs() {
        return this._get({url: this.gsUrl + "/gsqlserver/gsql/udtlist?graph=" + this.graphname, authMode: "pwd"});
    }

    getSchema(udts = true, force = false) {
        if (! this.schema || force) {
            this.schema = this._get({url: this.gsUrl + "/gsqlserver/gsql/schema?graph=" + this.graphname, authMode: "pwd"});
            if (udts) {
                this.schema["UDTs"] = this._getUDTs();
            }
        }
        return this.schema;
    }

    getUDTs() {
        let ret = [];
        let udts = this._getUDTs();
        for (let udt in udts) {
            ret.push(udts[udt]["name"]);
        }
        return ret;
    }

    getUDT(udtName) {
        let udts = this._getUDTs();
        for (let udt in udts) {
            if (udts[udt]["name"] === udtName) {
                return udts[udt]["fields"];
            }
        }
        return [];  // UDT was not found
    }

    upsertData(data) {
        if (typeof data !== "string") {
            data = JSON.stringify(data);
        }
        return this._post({url: this.restppUrl + "/graph/" + this.graphname, data: data})[0];
    }

    // Vertex related functions =================================================

    getVertexTypes(force = false) {
        let ret = [];
        let vts = this.getSchema(true, force)["VertexTypes"];
        for (let vt in vts) {
            ret.push(vts[vt]["Name"]);
        }
        return ret;
    }

    getVertexType(vertexType, force = false) {
        let vts = this.getSchema(true, force)["VertexTypes"];
        for (let vt in vts) {
            if (vts[vt]["Name"] === vertexType) {
                return vts[vt];
            }
        }
        return {}
    }

    getVertexCount(vertexType, where = "") {
        let res;
        // If WHERE condition is not specified, use /builtins else user /vertices
        if (where) {
            if (vertexType === "*") {
                throw new TigroidException("VertexType cannot be \"*\" if where condition is specified.", null);
            }
            res = this._get({url: this.restppUrl + "/graph/" + this.graphname + "/vertices/" + vertexType + "?count_only=true&filter=" + where});
        } else {
            let data = '{"function":"stat_vertex_number","type":"' + vertexType + '"}';
            res = this._post({url: this.restppUrl + "/builtins/" + this.graphname, data: data});
        }
        if (res.length === 1 && res[0]["v_type"] === vertexType) {
            return res[0]["count"];
        }
        let ret = {};
        for (let r in res) {
            ret[res[r]["v_type"]] = res[r]["count"];
        }
        return ret;
    }

    upsertVertex(vertexType, vertexId, attributes = null) {
        if ( typeof attributes !== "object") {
            return null;
        }
        let vals = this._upsertAttrs(attributes);
        let v = {};
        v[vertexId] = vals;
        let vt = {};
        vt[vertexType] = v;
        let data = JSON.stringify({vertices: vt})
        return this._post({url: this.restppUrl + "/graph/" + this.graphname, data: data})[0]["accepted_vertices"];
    }

    upsertVertices(vertexType, vertices) {
        if (! Array.isArray(vertices)) {
            return null;
        }
        let vts = {};
        for (let v in vertices) {
            let v1 = vertices[v];
            let vid = Object.keys(v1)[0];
            vts[vid] = this._upsertAttrs(v1[vid]);
        }
        let vt = {}
        vt[vertexType] = vts;
        let data = JSON.stringify({vertices: vt});
        return this._post({url: this.restppUrl + "/graph/" + this.graphname, data: data})[0]["accepted_vertices"];
    }

    _simplifyVertex(vertex) {
        if (! vertex) {
            return {};
        }
        let as = {};
        for (let a in vertex["attributes"]){
            as[a] = vertex["attributes"][a];
        }
        let v = {};
        v[vertex["v_id"]] = as;
        return v;
    }

    getVertices(vertexType, select = "", where = "", sort = "", limit = "", timeout = 0) {
        let url = this.restppUrl + "/graph/" + this.graphname + "/vertices/" + vertexType;
        let isFirst = true;
        if (select) {
            url += "?select=" + select;
            isFirst = false;
        }
        if (where) {
            url += (isFirst ? "?" : "&") + "filter=" + where;
            isFirst = false;
        }
        if (sort) {
            url += (isFirst ? "?" : "&") + "sort=" + sort;
            isFirst = false;
        }
        if (limit) {
            url += (isFirst ? "?" : "&") + "limit=" + limit.toString();
            isFirst = false;
        }
        if (timeout) {
            url += (isFirst ? "?" : "&") + "timeout=" + timeout.toString();
        }
        return this._get({url: url});
    }

    getVs(vertexType, select = "", where = "", sort = "", limit = "", timeout = 0) {
        let res = this.getVertices(vertexType, select, where, sort, limit, timeout);
        let ret = [];
        for (let i = 0; i < res.length; i++) {
            ret.push(this._simplifyVertex(res[i]));
        }
        return ret;
    }

    getVerticesById(vertexType, vertexIds) {
        if (! vertexIds) {
            throw new TigroidException("No vertex ID was specified.", null);
        }
        let vids = [];
        if (typeof vertexIds == "string") {
            vids.push(vertexIds);
        } else if (! Array.isArray(vertexIds)) {
            return null;
        } else {
            vids = vertexIds;
        }
        let url = this.restppUrl + "/graph/" + this.graphname + "/vertices/" + vertexType + "/";
        let ret = [];
        for (let vid in vids) {
            ret.push(this._get({url: url + vids[vid].toString()})[0]);
        }
        return ret;
    }

    getVsById(vertexType, vertexIds) {
        let res = this.getVerticesById(vertexType, vertexIds);
        let ret = [];
        for (let i = 0; i < res.length; i++) {
            ret.push(this._simplifyVertex(res[i]));
        }
        return ret;
    }

    // TODO: getVertexNeighbors()

    getVertexStats(vertexTypes, skipNA = false) {
        let vts = [];
        if (vertexTypes === "*") {
            vts = this.getVertexTypes();
        } else if (typeof vertexTypes === "string") {
            vts.push(vertexTypes);
        } else if (Array.isArray(vertexTypes)) {
            vts = vertexTypes;
        } else {
            return null;
        }
        let ret = {};
        for (let vt in vts) {
            let data = '{"function":"stat_vertex_attr","type":"' + vts[vt] + '"}';
            let res = this._post({url: this.restppUrl + "/builtins/" + this.graphname, data: data, resKey: null, skipCheck: true});
            if (res["error"]) {
                if (res["message"].search("stat_vertex_attr is skipped") !== -1) {
                    if (! skipNA) {
                        ret[vts[vt]] = {};
                    } else {
                        throw new TigroidException(res["message"], "code" in res ? res["code"] : null);
                    }
                }
            } else {
                res = res["results"];
                for (let r in res) {
                    ret[res[r]["v_type"]] = res[r]["attributes"];
                }
            }
        }
        return ret;
    }

    // TODO: delVertices()

    // TODO: delVerticesById()

    // Edge related functions ===================================================

    getEdgeTypes(force = false) {
        let ret = [];
        let ets = this.getSchema(force = force)["EdgeTypes"];
        for (let et in ets) {
            ret.push(ets[et]["Name"]);
        }
        return ret;
    }

    getEdgeType(edgeType, force = false) {
        let ets = this.getSchema(force = force)["EdgeTypes"];
        for (let et in ets) {
            if (ets[et]["Name"] === edgeType) {
                return ets[et];
            }
        }
        return {};
    }

    getEdgeSourceVertexType(edgeType) {
        let edgeTypeDetails = this.getEdgeType(edgeType);
        if (edgeTypeDetails["FromVertexTypeName"] === "*") {
            return "*";
        }
        let fromVertexTypes = edgeTypeDetails["FromVertexTypeList"];
            if (fromVertexTypes.length === 1) {
                return fromVertexTypes[0];
            }
        return fromVertexTypes;
    }

    getEdgeTargetVertexType(edgeType) {
        let edgeTypeDetails = this.getEdgeType(edgeType);
        if (edgeTypeDetails["ToVertexTypeName"] === "*") {
            return "*";
        }
        let toVertexTypes = edgeTypeDetails["ToVertexTypeList"];
        if (toVertexTypes.length === 1) {
            return toVertexTypes[0];
        }
        return toVertexTypes;
    }

    isDirected(edgeType) {
        return this.getEdgeType(edgeType)["IsDirected"];
    }

    getReverseEdge(edgeType) {
        if (! this.isDirected(edgeType)) {
            return null;
        }
        let config = this.getEdgeType(edgeType)["Config"];
        if ("REVERSE_EDGE" in config) {
            return config["REVERSE_EDGE"];
        }
        return null;
    }

    getEdgeCountFrom(sourceVertexType = null, sourceVertexId = null, edgeType = null, targetVertexType = null, targetVertexId = null, where = "") {
        // If WHERE condition is not specified, use /builtins else user /vertices
        let res;
        if (where || (sourceVertexType && sourceVertexId)) {
            if (!sourceVertexType || !sourceVertexId) {
                throw new TigroidException("If where condition is specified, then both sourceVertexType and sourceVertexId must be provided too.", null);
            }
            let url = this.restppUrl + "/graph/" + this.graphname + "/edges/" + sourceVertexType + "/" + sourceVertexId.toString();
            if (edgeType) {
                url += "/" + edgeType;
                if (targetVertexType) {
                    url += "/" + targetVertexType;
                    if (targetVertexId) {
                        url += "/" + targetVertexId.toString();
                    }
                }
            }
            url += "?count_only=true";
            if (where) {
                url += "&filter=" + where;
            }
            res = this._get({url: url});
        } else {
            if (!edgeType) {  // TODO: is this a valid check?
                throw new TigroidException("A valid edge type or \"*\" must be specified for edgeType.", null);
            }
            let data = '{"function":"stat_edge_number","type":"' + edgeType + '"'
                + (sourceVertexType ? ',"from_type":"' + sourceVertexType + '"' : '')
                + (targetVertexType ? ',"to_type":"' + targetVertexType + '"' : '')
                + '}';
            res = this._post({url: this.restppUrl + "/builtins/" + this.graphname, data: data});
        }
        if (res.length === 1 && res[0]["e_type"] === edgeType) {
            return res[0]["count"];
        }
        let ret = {}
        for (let r in res) {
            ret[res[r]["e_type"]] = res[r]["count"];
        }
        return ret;
    }

    getEdgeCount(edgeType = "*", sourceVertexType = null, targetVertexType = null) {
        return this.getEdgeCountFrom(sourceVertexType, null, edgeType, targetVertexType);
    }

    // TODO: upsertEdge()

    // TODO: upsertEdges()

    getEdges(sourceVertexType, sourceVertexId, edgeType = null, targetVertexType = null, targetVertexId = null, select = "", where = "", sort = "", limit = "", timeout = 0) {
        if (! sourceVertexType || ! sourceVertexId) {
            throw new TigroidException("Both source vertex type and source vertex ID must be provided.", null)
        }
        let url = this.restppUrl + "/graph/" + this.graphname + "/edges/" + sourceVertexType + "/" + sourceVertexId.toString();
        if (edgeType) {
            url += "/" + edgeType;
            if (targetVertexType) {
                url += "/" + targetVertexType;
                if (targetVertexId) {
                    url += "/" + targetVertexId.toString()
                }
            }
        }
        let isFirst = true;
        if (select) {
            url += "?select=" + select;
            isFirst = false;
        }
        if (where) {
            url += (isFirst ? "?" : "&") + "filter=" + where;
            isFirst = false;
        }
        if (sort) {
            url += (isFirst ? "?" : "&") + "sort=" + sort;
            isFirst = false;
        }
        if (limit) {
            url += (isFirst ? "?" : "&") + "limit=" + limit.toString();
            isFirst = false;
        }
        if (timeout && timeout > 0) {
            url += (isFirst ? "?" : "&") + "timeout=" + timeout.toString();
        }
        return this._get({url: url});
    }

    getEdgesByType(edgeType) {
        if (! edgeType) {
            return [];
        }

        // Check if ttk_getEdgesFrom query was installed
        if (this.ttkGetEF == null) {
            this.ttkGetEF = false;
            let eps = this.getEndpoints(false,true);
            for (let ep in eps) {
                if (ep.endsWith("ttk_getEdgesFrom")) {
                    this.ttkGetEF = true;
                }
            }
        }
        let sourceVertexType = this.getEdgeSourceVertexType(edgeType);
        if (sourceVertexType === "*") {
            throw new TigroidException("Wildcard edges are not currently supported.", null);
        }

        let ret;
        if (this.ttkGetEF) { // If installed version is available, use it, as it can return edge attributes too.
            if (this.debug) {
                console.log("Using installed query.")
            }
            ret = this.runInstalledQuery("ttk_getEdgesFrom", {"edgeType": edgeType, "sourceVertexType": sourceVertexType});
        } else {  // If installed version is not available, use interpreted version. Always available, but can't return attributes.
            if (this.debug) {
                console.log("Using interpreted query.")
            }
            let queryText =
'INTERPRET QUERY () FOR GRAPH $graphname {\n' +
'    SetAccum<EDGE> @@edges; \n' +
'    start = {ANY}; \n' +
'    res = \n' +
'        SELECT s \n' +
'        FROM   start:s-(:e)->ANY:t \n' +
'        WHERE  e.type == "$edgeType" \n' +
'           AND s.type == "$sourceEdgeType" \n' +
'        ACCUM  @@edges += e; \n' +
'    PRINT @@edges AS edges; \n' +
'}';

            queryText = queryText.replace("$graphname", this.graphname)
                .replace('$sourceEdgeType', sourceVertexType)
                .replace('$edgeType', edgeType);
            ret = this.runInterpretedQuery(queryText)
        }
        return ret[0]["edges"]
    }

    getEdgeStats(edgeTypes, skipNA = false) {
        let ets = [];
        if (edgeTypes === "*") {
            ets = this.getEdgeTypes();
        } else if (typeof edgeTypes === "string") {
            ets = [edgeTypes];
        } else if (Array.isArray(edgeTypes)) {
            ets = edgeTypes;
        } else {
            return null;
        }
        let ret = {};
        for (let et in ets) {
            let data = '{"function":"stat_edge_attr","type":"' + ets[et] + '","from_type":"*","to_type":"*"}';
            let res = this._post({url: this.restppUrl + "/builtins/" + this.graphname, data: data, resKey: null, skipCheck: true});
            if (res["error"]) {
                if (res["message"].search("stat_edge_attr is skiped") !== -1 || res["message"].search("No valid edge") !== -1) {
                    if (!skipNA) {
                        ret[ets[et]] = {};
                    }
                } else {
                    throw new TigroidException(res["message"], "code" in res ? res["code"] : null);
                }
            } else {
                res = res["results"];
                for (let r in res) {
                    ret[res[r]["e_type"]] = res[r]["attributes"];
                }
            }
        }
        return ret
    }

    // TODO: delEges()

    // Query related functions ==================================================

    runInstalledQuery(queryName, params = null, timeout = 16000, sizeLimit = 32000000) {
        return this._get({url: this.restppUrl + "/query/" + this.graphname + "/" + queryName, params: params, headers: {"RESPONSE-LIMIT": sizeLimit.toString(), "GSQL-TIMEOUT": timeout.toString()}});
    }

    runInterpretedQuery(queryText, params = null) {
        queryText = queryText.replace("$graphname", this.graphname);
        if (this.debug) {
            console.log(queryText);
        }
        return this._post({url: this.gsUrl + "/gsqlserver/interpreted_query", data: queryText, params: params, authMode: "pwd"});
    }

    // Token management =========================================================

    getToken(secret, setToken = true, lifetime = null) {
        this.xhr.open("GET", this.restppUrl + "/requesttoken?secret=" + secret + (lifetime ? "&lifetime=" + lifetime.toString() : ""), false);
        this.xhr.send();
        let res = JSON.parse(this.xhr.responseText);
        if (! res["error"]) {
            if (setToken) {
                this.apiToken = res["token"];
                this.authHeader = {'Authorization': "Bearer " + this.apiToken};
            }
            return {token: res["token"], expiration: res["expiration"], expiration_datetime: (new Date(res["expiration"] * 1000)).toISOString()};
        }
        if (res["message"].search("Endpoint is not found from url = /requesttoken") !== -1) {
            throw new TigroidException("REST++ authentication is not enabled, can't generate token.", null);
        }
        throw new TigroidException(res["message"], "code" in res ? res["code"] : null);
    }

    refreshToken(secret, token = null, lifetime = 2592000) {
        if (! token) {
            token = this.apiToken;
        }
        this.xhr.open("PUT", this.restppUrl + "/requesttoken?secret=" + secret + "&token=" + token + (lifetime ? "&lifetime=" + lifetime.toString() : ""), false);
        this.xhr.send();
        let res = JSON.parse(this.xhr.responseText);
        if (! res["error"]) {
            let exp = Date.now() + res["expiration"]
            return {token: res["token"], expiration: Number.parseInt(exp), expiration_datetime: (new Date(exp * 1000)).toISOString()};
        }
        if (res["message"].search("Endpoint is not found from url = /requesttoken") !== -1) {
            throw new TigroidException("REST++ authentication is not enabled, can't refresh token.", null);
        }
        throw new TigroidException(res["message"], "code" in res ? res["code"] : null);
    }

    deleteToken(secret, token = null, skipNA = true) {
        if (! token) {
            token = this.apiToken;
        }
        this.xhr.open("DELETE", this.restppUrl + "/requesttoken?secret=" + secret + "&token=" + token, false);
        this.xhr.send();
        let res = JSON.parse(this.xhr.responseText);
        if (! res["error"]) {
            return true;
        }
        if (res["code"] === "REST-3300" && skipNA) {
            return true;
        }
        if (res["message"].search("Endpoint is not found from url = /requesttoken") !== -1) {
            throw new TigroidException("REST++ authentication is not enabled, can't delete token.", null);
        }
        throw new TigroidException(res["message"], "code" in res ? res["code"] : null);
    }

    // Other functions ==========================================================

    echo() {
        return this._get({url: this.restppUrl + "/echo/" + this.graphname, resKey: "message"});
    }

    getEndpoints(builtins = false, dynamics = false, statics = false) {
        let ret = {};
        let bui, dyn, sta;
        if (! builtins && ! dynamics && ! statics) {
            bui = dyn = sta = true;
        }
        else {
            bui = builtins;
            dyn = dynamics;
            sta = statics;
        }
        let url = this.restppUrl + "/endpoints/" + this.graphname + "?";
        if (bui) {
            let eps = {};
            let res = this._get({url: url + "builtin=true", resKey: null})
            for (const ep in res) {
                if (ep.search(/ \/graph\//) === -1 || ep.search(/ \/graph\/{graph_name}\//) !== -1) {
                    eps[ep] = res[ep];
                }
            }
            ret = Object.assign(ret, eps);
        }
        if (dyn) {
            let pattern = new RegExp("^GET \/query\/" + this.graphname);
            let eps = {}
            let res = this._get({url: url + "dynamic=true", resKey: null})
            for (let ep in res) {
                if (ep.search(pattern) !== -1) {
                    eps[ep] = res[ep];
                }
            }
            ret = Object.assign(ret, eps);
        }
        if (sta) {
            ret = Object.assign(ret, this._get({url: url + "static=true", resKey: null}))
        }
        return ret;
    }

    getStatistics(seconds = 10, segment = 10) {
        if (! seconds || typeof seconds !== "number") {
            seconds = 10;
        } else {
            seconds = Math.max(Math.min(seconds, 0), 60);
        }
        if (! segment || typeof segment !== "number") {
            segment = 10;
        } else {
            segment = Math.max(Math.min(segment, 0), 100);
        }
        return this._get({url: this.restppUrl + "/statistics/" + this.graphname + "?seconds=" + seconds.toString() + "&segment=" + segment.toString(), resKey: null});
    }

    getVersion() {
        this.xhr.open("GET", this.restppUrl + "/version/" + this.graphname, false);
        // TODO: this.xhr.setRequestHeader("Authorization", "Bearer " + this.apiToken);
        this.xhr.send();
        let res = this.xhr.responseText;
        res = res.substring(res.search("TigerGraph RESTPP"),res.search("\"}")).split(/\n/);
        let components = [];
        for (let i = 3; i < res.length - 1; i++) {
            let m =  res[i].split(/ +/);
            let component = {name: m[0], version: m[1], hash: m[2], datetime: m[3] + " " + m[4] + " " + m[5]};
            components.push(component);
        }
        return components;
    }

    getVer(component = "product", full = false) {
        let ret = "";
        let components = this.getVersion();
        for (let i = 0; i < components.length; i++) {
            let v = components[i];
            if (v["name"] === component) {
                ret = v["version"];
            }
        }
        if (ret) {
            if (full) {
                return ret;
            }
            return ret.substring(ret.indexOf("_") + 1, ret.lastIndexOf("_"));
        } else {
            throw new TigroidException("\"" + component + "\" is not a valid component.", null);
        }
    }

    getLicenseInfo() {
        let res = this._get({url: this.restppUrl + "/showlicenseinfo", resKey: null, skipCheck: true});
        let ret = {};
        if (! res["error"]) {
            ret["message"] = res["message"];
            ret["expirationDate"] = res["results"][0]["Expiration date"];
            ret["daysRemaining"] = res["results"][0]["Days remaining"];
        } else if ("code" in res && res["code"] === "REST-5000") {
            ret["message"] = "This instance does not have a valid enterprise license. Is this a trial version?";
            ret["daysRemaining"] = -1;
        } else {
            throw new TigroidException(res["message"], res["code]"]);
        }
        return ret
    }

    // ==========================================================================

    constructor({host = "http://localhost", graphname = "MyGraph", username = "tigergraph", password = "tigergraph", restppPort = "9000", gsPort = "14240", apiToken = "", debug = false}) {
        this.host       = host;
        this.graphname  = graphname;
        this.username   = username;
        this.password   = password;
        this.restppPort = restppPort;
        this.restppUrl  = this.host + ":" + this.restppPort;
        this.gsPort     = gsPort.toString();
        this.gsUrl      = this.host + ":" + this.gsPort;
        this.apiToken   = apiToken;
        this.authHeader = {"Authorization": "Bearer " + this.apiToken};
        this.debug      = debug;
        this.schema     = null;
        this.ttkGetEF   = null;

        if (window.XMLHttpRequest) {
            this.xhr = new XMLHttpRequest();
        } else {
            this.xhr = new ActiveXObject("Microsoft.XMLHTTP");
        }
    }
}