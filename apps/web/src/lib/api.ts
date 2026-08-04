import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3333";

let accessToken: string | null = localStorage.getItem("lumas_access_token");

export const setAccessToken = (token: string | null) => {
  accessToken = token;
  if (token) {
    localStorage.setItem("lumas_access_token", token);
  } else {
    localStorage.removeItem("lumas_access_token");
  }
};

export const getAccessToken = () => accessToken;

export const api = axios.create({
  baseURL: API_URL,
  withCredentials: true
});

api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});
