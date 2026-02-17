import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AccountProvider } from './contexts/AccountContext';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Post from './pages/Post';
import Competitors from './pages/Competitors';
import Settings from './pages/Settings';
import QuoteWorkflow from './pages/QuoteWorkflow';
import ReplyWorkflow from './pages/ReplyWorkflow';
import AutoPost from './pages/AutoPost';

export default function App() {
  return (
    <BrowserRouter>
      <AccountProvider>
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/post" element={<Post />} />
            <Route path="/quote-workflow" element={<QuoteWorkflow />} />
            <Route path="/reply-workflow" element={<ReplyWorkflow />} />
            <Route path="/auto-post" element={<AutoPost />} />
            <Route path="/competitors" element={<Competitors />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </Layout>
      </AccountProvider>
    </BrowserRouter>
  );
}
