"use client";

import { useSignIn, useUser } from "@clerk/nextjs";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const LoginPage = () => {
  const { isLoaded, isSignedIn, user } = useUser();
  const { signIn, setActive } = useSignIn();
  const router = useRouter();

  //console.log("User:", user);

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isLoaded) return;
    const role = user?.publicMetadata.role;

    if (isSignedIn && role) {
      router.push(`/${role}`);
    } else if (isSignedIn) {
      router.push("/");
    }
  }, [isLoaded, isSignedIn, user, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoaded || !signIn || !setActive) return;
    setError("");

    try {
      const result = await signIn.create({
        identifier,
        password,
      });

      if (result.status === "complete") {
        await setActive({ session: result.createdSessionId });
        router.push("/");
      }
    } catch (err: any) {
      setError(err.errors?.[0]?.message ?? "An error occurred");
    }
  };

  return (
    <div className="h-screen flex items-center justify-center bg-lamaSkyLight">
      <form
        onSubmit={handleSubmit}
        className="bg-white p-12 rounded-md shadow-2xl flex flex-col gap-2"
      >
        <h1 className="text-xl font-bold flex items-center gap-2">
          {/* <Image src="/logo.png" alt="" width={24} height={24} /> */}
          <Image
            src="/adu-dev-logo-transparent-background.png"
            alt=""
            width={36}
            height={36}
          />
          Adu Dev School
        </h1>
        <h2 className="text-gray-400">Sign in to your account</h2>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex flex-col gap-2">
          <label className="text-xs text-gray-500">Username</label>
          <input
            type="text"
            required
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            className="p-2 rounded-md ring-1 ring-gray-300"
          />
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-xs text-gray-500">Password</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="p-2 rounded-md ring-1 ring-gray-300"
          />
        </div>
        <button
          type="submit"
          className="bg-blue-500 text-white my-1 rounded-md text-sm p-[10px]"
        >
          Sign In
        </button>
      </form>
    </div>
  );
};

export default LoginPage;
