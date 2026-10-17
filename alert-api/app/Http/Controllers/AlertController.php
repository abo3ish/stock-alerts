<?php

namespace App\Http\Controllers;

use App\Models\Alert;
use App\Services\AlertCache;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AlertController extends Controller
{
    public function index(Request $request)
    {
        $request->validate(['user_id' => 'required|integer|min:1']);

        return Alert::where('user_id', $request->integer('user_id'))->latest('id')->paginate(50);
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'user_id' => 'required|integer|min:1',
            'symbol' => ['required', 'string', 'regex:/^[A-Z0-9]{1,10}$/'],
            'condition' => 'required|in:above,below',
            'target_price' => 'required|numeric|gt:0|max:9999999999',
        ]);

        // Outbox: the alert and its "sync me" row commit together. Redis is updated by alerts:relay,
        // so a Redis outage delays the alert instead of losing it or failing the request.
        $alert = DB::transaction(function () use ($data) {
            $alert = Alert::create($data);
            AlertCache::enqueue($alert);

            return $alert;
        });

        return response()->json($alert, 201);
    }

    public function update(Request $request, Alert $alert)
    {
        // Symbol is not editable: it is the cache key. Delete and recreate instead.
        $data = $request->validate([
            'condition' => 'sometimes|in:above,below',
            'target_price' => 'sometimes|numeric|gt:0|max:9999999999',
        ]);

        DB::transaction(function () use ($alert, $data) {
            $alert->update($data);
            AlertCache::enqueue($alert);
        });

        return $alert;
    }

    public function destroy(Alert $alert)
    {
        DB::transaction(function () use ($alert) {
            $alert->delete();
            AlertCache::enqueue($alert);
        });

        return response()->noContent();
    }
}
