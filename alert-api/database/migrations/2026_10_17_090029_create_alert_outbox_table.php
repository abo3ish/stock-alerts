<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * "Alert X changed, sync it to Redis". Written in the same transaction as the alert itself,
     * so either both exist or neither does. Rows are deleted once applied.
     */
    public function up(): void
    {
        Schema::create('alert_outbox', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('alert_id');
            $table->string('symbol', 10); // kept here so a delete still knows which hash to clean
            $table->timestamp('created_at')->useCurrent();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('alert_outbox');
    }
};
