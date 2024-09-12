import { FetchResult } from "../types";
import axios from "axios";

export function fetchGeneration(url: string, request: any): Promise<FetchResult> {
    return new Promise((resolve, reject) => {
        request = JSON.stringify(request);
        return axios.post(url, request, {
            headers: {
                "Content-Type": "application/json",
            },
        }).then(respone => respone.data).then(content => resolve({ content, url })).catch(reject);
    });
}